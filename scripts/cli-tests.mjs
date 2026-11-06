#!/usr/bin/env node
/**
 * `pnpm test:cli`: the CLI scenarios (cli/tests) against a local server, with
 * the server handled for you (AGENTS.md, "CLI tests"; docs/cli.md).
 *
 * 1. Reuse a healthy, compatible server at ZIKI_CLI_URL (default
 *    http://localhost:3001): this checkout's own `next dev` (its
 *    .next/dev/lock names that port and a live process) started after the
 *    Prisma client and .env last changed. With --server-url, any healthy
 *    local server you name is used as is.
 * 2. Otherwise start `next dev` once, and wait for /api/health at most
 *    --ready-timeout seconds (90). On timeout, print what the health check
 *    saw and the end of the server log, stop the server, exit 3.
 * 3. Run the scenarios (extra arguments go to Vitest, e.g. `lifecycle`).
 * 4. Stop the server only if this run started it.
 *
 * Exit codes: 0 passed, 1 scenarios failed, 3 no usable server (nothing ran,
 * or it went away mid-run). The scenarios never seed or reset a database:
 * they rebuild only their own `cli-test-<n>` organisations, and the CLI refuses any
 * non-local database or server.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { duration, isAlive, mtime, prismaClientSchema, probe, readVitestReport, runPhase, startServer, tail, toolCommand, waitForReady } from "./verify/lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGS = process.env.CLI_TEST_LOG_DIR ? path.resolve(process.env.CLI_TEST_LOG_DIR) : path.join(ROOT, "node_modules", ".cache", "cli-tests");
const SERVER_UNAVAILABLE = 3;

const argv = process.argv.slice(2);
const takeOption = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const [, value] = argv.splice(index, 2);
  return value;
};
const explicitUrl = takeOption("server-url", undefined);
const readyTimeout = Number(takeOption("ready-timeout", "90"));
const testTimeoutMinutes = Number(takeOption("timeout-minutes", "20"));
const vitestArgs = argv;

const base = new URL(explicitUrl ?? process.env.ZIKI_CLI_URL ?? "http://localhost:3001").origin;
const healthUrl = `${base}/api/health`;
const say = (text) => console.log(`[cli-tests] ${text}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

/** This checkout's `next dev`, from the lock file Next writes: { pid, port, startedAt } or null. */
function devLock() {
  const file = path.join(ROOT, ".next", "dev", "lock");
  if (!existsSync(file)) return null;
  try {
    const lock = JSON.parse(readFileSync(file, "utf8"));
    return isAlive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}

/** Files a running dev server read at start: if one changed since, the server is stale. */
function staleInputs(startedAt) {
  const inputs = [path.join(ROOT, ".env"), prismaClientSchema(ROOT)].filter(Boolean);
  return inputs.filter((file) => mtime(file) > startedAt).map((file) => (file.endsWith("schema.prisma") ? "the generated Prisma client" : path.relative(ROOT, file)));
}

/** A reusable server, a reason to start one, or a reason none can be used. */
async function findServer() {
  const health = await probe(healthUrl, 3_000);
  const lock = devLock();
  const port = Number(new URL(base).port || 80);
  if (health.ok) {
    if (explicitUrl) return { reuse: true, note: `using ${base} as given (--server-url)` };
    if (lock && lock.port === port) {
      const stale = staleInputs(lock.startedAt);
      if (stale.length) return { unavailable: `this checkout's dev server on ${base} (pid ${lock.pid}) started before ${stale.join(" and ")} changed. Stop it and run again (or pass --server-url ${base} to use it anyway).` };
      return { reuse: true, note: `reusing this checkout's dev server on ${base} (pid ${lock.pid})` };
    }
    return { unavailable: `${base} is served by a server this checkout did not start${lock ? ` (this checkout's dev server is on port ${lock.port})` : ""}. Stop it and run again, or pass --server-url ${base} to use it as is.` };
  }
  if (lock) return { unavailable: `this checkout's dev server (pid ${lock.pid}, port ${lock.port}) is running but ${healthUrl} does not answer (${health.error ?? `HTTP ${health.status}`}). Next allows one dev server per checkout: stop it and run again.` };
  if (health.status !== null) return { unavailable: `${healthUrl} answers HTTP ${health.status}; something else holds that port.` };
  return { start: true };
}

let server = null;
async function cleanup() {
  if (server) {
    const running = server;
    server = null;
    await running.stop();
    say(`stopped the dev server this run started (log: ${path.relative(ROOT, running.logFile)})`);
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => cleanup().finally(() => process.exit(130)));

async function main() {
  const timings = {};
  const found = await findServer();
  if (found.unavailable) {
    say(`server unavailable: ${found.unavailable}`);
    return SERVER_UNAVAILABLE;
  }
  if (found.reuse) {
    say(found.note);
  } else {
    const port = new URL(base).port || "3001";
    const [command, prefix] = toolCommand(ROOT, "next");
    server = startServer({ command, args: [...prefix, "dev", "--port", port], cwd: ROOT, env: process.env, logFile: path.join(LOGS, `${stamp}-server.log`) });
    say(`started next dev on port ${port} (pid ${server.child.pid}); waiting up to ${readyTimeout}s for ${healthUrl}`);
    const wait = await waitForReady({ url: healthUrl, timeoutMs: readyTimeout * 1000, child: server.child });
    timings.serverReady = wait.seconds;
    if (!wait.ready) {
      say(`server unavailable: ${wait.exited ? `next dev exited (code ${wait.exited.code}${wait.exited.signal ? `, ${wait.exited.signal}` : ""})` : `not ready after ${readyTimeout}s`}; ${wait.attempts} health checks, the last ${wait.last ? (wait.last.status ? `HTTP ${wait.last.status}` : wait.last.error) : "never sent"}.`);
      say(`last lines of the server log (full log: ${path.relative(ROOT, server.logFile)}):`);
      console.log(tail(server.logFile, 60));
      return SERVER_UNAVAILABLE;
    }
    say(`server ready in ${duration(wait.seconds)}`);
  }

  const [command, prefix] = toolCommand(ROOT, "vitest");
  const report = path.join(LOGS, `${stamp}-scenarios.json`);
  const run = await runPhase({
    name: "cli scenarios",
    command,
    args: [...prefix, "run", "--config", "vitest.cli.config.ts", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`, ...vitestArgs],
    cwd: ROOT,
    env: { ...process.env, ZIKI_CLI_URL: base, FORCE_COLOR: "0" },
    logFile: path.join(LOGS, `${stamp}-scenarios.log`),
    timeoutMs: testTimeoutMinutes * 60_000,
    echo: true,
  });
  timings.scenarios = run.seconds;
  const counts = readVitestReport(report, ROOT);
  // A file can fail outside any test (a hook, an import), so failing files are counted apart from failed tests.
  const summary = counts
    ? `${counts.files} files (${counts.failedFiles} failing), ${counts.tests} tests: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`
    : "no report";
  say(`${run.status} in ${duration(run.seconds)}: ${summary} (log: ${path.relative(ROOT, run.logFile)})`);
  if (timings.serverReady !== undefined) say(`waiting for the server took ${duration(timings.serverReady)}; the scenarios ${duration(timings.scenarios)}`);
  if (run.status === "passed") return 0;
  // Tell a server that went away apart from scenarios that failed.
  const after = await probe(healthUrl, 3_000);
  if (!after.ok) {
    say(`server unavailable: ${healthUrl} stopped answering during the run (${after.error ?? `HTTP ${after.status}`}).`);
    if (server) console.log(tail(server.logFile, 60));
    return SERVER_UNAVAILABLE;
  }
  if (counts && counts.tests === 0) say("no scenario ran: the global setup failed (see the log above for the reason).");
  return 1;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(`[cli-tests] could not run: ${error instanceof Error ? error.stack : error}`);
  code = 1;
} finally {
  await cleanup();
}
process.exit(code);
