/**
 * The pieces behind `pnpm verify:*` and `pnpm test:cli` (see AGENTS.md,
 * "Testing"). Kept free of side effects at import time so the unit tests in
 * this folder can drive each one against throwaway directories.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const TEST_FILE = /\.(test|spec)\.tsx?$/;
const CODE_FILE = /\.(tsx?|mts|cts|mjs|cjs|jsx?)$/;
const LINTED_FILE = /\.(tsx?|mts|cts|mjs|cjs|jsx?)$/;
/** Never walked for the import graph: dependencies, output, nested checkouts, separate suites. */
const GRAPH_SKIP = new Set(["node_modules", ".next", ".git", ".claude", ".worktrees", "coverage", "packages", "e2e", "test-results", "playwright-report"]);

/**
 * Inputs that every test (or the toolchain itself) depends on. A change to one
 * of these means the affected tests can't be worked out from imports, so a
 * recheck turns into a full run and says why.
 */
const SHARED_INPUTS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-organisation\.yaml$/,
  /^\.npmrc$/,
  /^\.nvmrc$/,
  /^vitest\.config\.[cm]?[jt]s$/,
  /^tsconfig(\..+)?\.json$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^next\.config\.[cm]?[jt]s$/,
  /^prisma\/schema\.prisma$/,
];

/** Environment variables that change what the checks do. Their values are hashed, never printed. */
export const ENV_INPUTS = ["NODE_OPTIONS", "NODE_ENV", "TZ", "CI", "VITEST_MAX_WORKERS", "DATABASE_URL", "AGENT_PLATFORM", "NEXT_PUBLIC_AGENT_PLATFORM"];

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
export const posix = (file) => file.split(path.sep).join("/");

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

/** True while `pid` is a running process. */
export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Signals a process and everything it started, without waiting. Children are
 * spawned in their own group on POSIX (`detached`), so the whole group gets
 * the signal; on Windows `taskkill /T /F` walks the tree. Never block here
 * waiting for the exit: on POSIX a killed child stays a zombie (and looks
 * alive) until the event loop reaps it, so callers wait for its exit event.
 */
export function killTree(pid, signal = "SIGTERM") {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 15_000 });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

/**
 * Stops `child` and its tree: SIGTERM, then SIGKILL if it hasn't exited
 * after `graceMs`. Resolves once it has exited, or after a last bound.
 *
 * @param {import("node:child_process").ChildProcess} child
 */
export function stopTree(child, graceMs = 3_000) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(escalate);
      clearTimeout(giveUp);
      resolve(undefined);
    };
    child.once("exit", done);
    const escalate = setTimeout(() => killTree(child.pid, "SIGKILL"), graceMs);
    const giveUp = setTimeout(() => {
      child.off("exit", done);
      resolve(undefined);
    }, graceMs + 5_000);
    killTree(child.pid, "SIGTERM");
  });
}

/**
 * Spawn options that let `killTree` stop the whole tree. No shell: tools run
 * as `node <their bin script>` (see `toolCommand`), so arguments such as
 * `app/(app)/page.test.tsx` reach them unmangled on every platform.
 */
function spawnOptions(cwd, env) {
  return { cwd, env, shell: false, detached: process.platform !== "win32", windowsHide: true };
}

/** The package that provides each command the package.json scripts use. */
const TOOL_PACKAGES = { eslint: "eslint", tsc: "typescript", vitest: "vitest", next: "next", prisma: "prisma" };

/** `node <bin script>` for a tool installed in `root`, e.g. toolCommand(root, "tsc") → [node, .../typescript/bin/tsc]. */
export function toolCommand(root, tool) {
  const pkg = TOOL_PACKAGES[tool] ?? tool;
  const dir = path.join(root, "node_modules", pkg);
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[tool] ?? Object.values(manifest.bin ?? {})[0];
  if (!bin) throw new Error(`${pkg} has no bin entry`);
  return [process.execPath, [path.join(dir, bin)]];
}

/**
 * A package.json script as `{ command, args }` without a shell, so the verify
 * phases run exactly what `pnpm lint` / `pnpm typecheck` run. The scripts it
 * reads are plain `tool --flag value` lines.
 */
export function scriptCommand(root, name, extraArgs = []) {
  const script = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts?.[name];
  if (!script || /[&|;<>"'`$]/.test(script)) throw new Error(`package.json script "${name}" is missing or is not a single plain command: ${script}`);
  const [tool, ...args] = script.trim().split(/\s+/);
  const [command, prefix] = toolCommand(root, tool);
  return { command, args: [...prefix, ...args, ...extraArgs] };
}

/**
 * Runs one phase to completion, with every byte of its stdout and stderr in
 * `logFile` (nothing is filtered or truncated), and a hard timeout after which
 * the whole process tree is stopped. Never throws: a command that can't start
 * is reported as `error`.
 *
 * Returns { name, status: "passed" | "failed" | "timeout" | "error", exitCode, seconds, logFile, startedAt, error? }.
 *
 * @param {{ name: string, command: string, args?: string[], cwd: string, env?: Record<string, string | undefined>, logFile: string, timeoutMs: number, echo?: boolean }} options
 * @returns {Promise<{ name: string, status: "passed" | "failed" | "timeout" | "error", exitCode: number | null, seconds: number, logFile: string, startedAt: string, error?: string }>}
 */
export function runPhase({ name, command, args = [], cwd, env = process.env, logFile, timeoutMs, echo = false }) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const started = Date.now();
  return new Promise((resolve) => {
    const log = createWriteStream(logFile);
    log.write(`$ ${[command, ...args].join(" ")}\n# cwd ${cwd}\n# started ${new Date(started).toISOString()}\n\n`);
    let child;
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const seconds = (Date.now() - started) / 1000;
      log.end(`\n# ${result.status}${result.exitCode !== null && result.exitCode !== undefined ? ` (exit ${result.exitCode})` : ""} after ${seconds.toFixed(1)}s\n`, () =>
        resolve({ name, logFile, seconds, startedAt: new Date(started).toISOString(), ...result }),
      );
    };
    try {
      child = spawn(command, args, { ...spawnOptions(cwd, env), stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ status: "error", exitCode: null, error: String(error?.message ?? error) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      log.write(`\n# timed out after ${(timeoutMs / 1000).toFixed(0)}s; stopping the process tree\n`);
      void stopTree(child);
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        log.write(chunk);
        if (echo) process.stdout.write(chunk);
      });
    }
    child.on("error", (error) => finish({ status: "error", exitCode: null, error: String(error?.message ?? error) }));
    child.on("close", (code, signal) => {
      if (timedOut) finish({ status: "timeout", exitCode: code, error: `no result within ${(timeoutMs / 1000).toFixed(0)}s` });
      else if (code === 0) finish({ status: "passed", exitCode: 0 });
      else finish({ status: "failed", exitCode: code, ...(signal ? { error: `stopped by ${signal}` } : {}) });
    });
  });
}

/**
 * Runs groups of phases in order, the phases in a group side by side. Every
 * group runs whatever the earlier ones returned: a failed lint never hides a
 * failing test. `start(name)` returns a promise of that phase's result.
 *
 * @template T
 * @param {string[][]} groups
 * @param {(name: string) => Promise<T>} start
 * @returns {Promise<T[]>}
 */
export async function runSchedule(groups, start) {
  const results = [];
  for (const group of groups) results.push(...(await Promise.all(group.map((name) => start(name)))));
  return results;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

const git = (root, args, env) => execFileSync("git", args, { cwd: root, env: env ?? process.env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60_000 }).trim();

/**
 * Every file the checks read, as git would commit it (tracked and untracked
 * files, after .gitignore), by content hash. Done through a throwaway index so
 * the real one is untouched. Ignored paths, such as the logs under
 * node_modules/.cache, are not inputs, so writing a log never changes the key.
 *
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function fileManifest(root) {
  const index = path.join(tmpdir(), `verify-index-${process.pid}-${Date.now()}`);
  const real = path.resolve(root, git(root, ["rev-parse", "--git-path", "index"]));
  if (existsSync(real)) copyFileSync(real, index);
  try {
    const env = { ...process.env, GIT_INDEX_FILE: index };
    // core.safecrlf=false: no "LF will be replaced by CRLF" line per file on a Windows checkout.
    git(root, ["-c", "core.safecrlf=false", "add", "-A"], env);
    const files = {};
    for (const line of git(root, ["ls-files", "-s", "-z"], env).split("\0")) {
      const match = /^(\d+) ([0-9a-f]+) \d+\t(.+)$/s.exec(line);
      if (match) files[match[3]] = match[2];
    }
    return files;
  } finally {
    rmSync(index, { force: true });
  }
}

function hashIfPresent(file) {
  return existsSync(file) ? sha256(readFileSync(file)) : null;
}

/** The schema the generated Prisma client was built from, or null when there is none. */
export function prismaClientSchema(root) {
  try {
    const clientDir = path.dirname(execFileSync(process.execPath, ["-p", "require.resolve('.prisma/client/index.js', { paths: [require.resolve('@prisma/client')] })"], { cwd: root, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] }).trim());
    const schema = path.join(clientDir, "schema.prisma");
    return existsSync(schema) ? schema : null;
  } catch {
    return null;
  }
}

/**
 * What a verification result depends on beyond the files: the runtime, the
 * installed dependencies (which can differ from the lockfile until you
 * reinstall), the generated Prisma client, and the environment variables in
 * ENV_INPUTS (hashed).
 *
 * @param {string} root
 * @param {Record<string, string | undefined>} [env]
 */
export function environmentInputs(root, env = process.env) {
  const schema = prismaClientSchema(root);
  const prismaClient = schema ? hashIfPresent(schema) : null;
  return {
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    installedDependencies: hashIfPresent(path.join(root, "node_modules", ".pnpm", "lock.yaml")) ?? hashIfPresent(path.join(root, "node_modules", ".modules.yaml")),
    prismaClient,
    env: sha256(JSON.stringify(ENV_INPUTS.map((key) => [key, env[key] ?? null]))),
  };
}

/**
 * The verification key: one hash over the files and the environment inputs.
 *
 * @param {string} root
 * @param {Record<string, string | undefined>} [env]
 */
export function inputState(root, env = process.env) {
  const files = fileManifest(root);
  const environment = environmentInputs(root, env);
  const key = sha256(JSON.stringify({ files: Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)), environment }));
  return { key, files, environment };
}

/**
 * Files added, removed or changed between two manifests.
 *
 * @param {Record<string, string>} before
 * @param {Record<string, string>} after
 */
export function changedBetween(before, after) {
  const changed = new Set();
  for (const [file, blob] of Object.entries(after)) if (before[file] !== blob) changed.add(file);
  for (const file of Object.keys(before)) if (!(file in after)) changed.add(file);
  return [...changed].sort();
}

/**
 * Environment inputs that differ, by name (values are hashes or versions).
 *
 * @param {Record<string, string | null> | undefined} before
 * @param {Record<string, string | null>} after
 */
export function changedEnvironment(before, after) {
  return Object.keys({ ...before, ...after }).filter((key) => before?.[key] !== after?.[key]);
}

/**
 * Why `changed` needs a full run, or null when the affected tests can be worked out.
 *
 * @param {string[]} changed
 * @param {string[]} [environmentChanges]
 */
export function fullRunReason(changed, environmentChanges = []) {
  if (environmentChanges.length) return `the environment changed (${environmentChanges.join(", ")})`;
  const shared = changed.filter((file) => SHARED_INPUTS.some((pattern) => pattern.test(file)));
  if (shared.length) return `shared inputs changed (${shared.join(", ")})`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Which tests a change affects                                        */
/* ------------------------------------------------------------------ */

function walk(root, dir = root, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!GRAPH_SKIP.has(entry.name)) walk(root, path.join(dir, entry.name), found);
    } else if (CODE_FILE.test(entry.name)) {
      found.push(posix(path.relative(root, path.join(dir, entry.name))));
    }
  }
  return found;
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock)\s*(?:<[^>]*>)?\s*\(\s*)["']([^"'\n]+)["']/g;
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"];

/** The repo path a local specifier points at, before extensions: `@/lib/a` → `lib/a`. Null for packages. */
function specifierBase(fromFile, specifier) {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  return null;
}

function resolveSpecifier(fromFile, specifier, known) {
  const base = specifierBase(fromFile, specifier);
  if (base === null) return null;
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (known.has(candidate)) return candidate;
  }
  // A `.js` specifier that names a `.ts` file (ESM style).
  const stripped = base.replace(/\.(m|c)?js$/, "");
  for (const ext of [".ts", ".tsx", ".mts", ".cts"]) if (known.has(`${stripped}${ext}`)) return `${stripped}${ext}`;
  return null;
}

/**
 * Each code file's static imports (and vi.mock targets), resolved to repo
 * paths, plus the local imports that no longer resolve (`dangling`, by the
 * path they name), so a deleted file still leads to what imported it.
 */
export function importGraph(root) {
  const files = walk(root);
  const known = new Set(files);
  const sources = new Map();
  const dependents = new Map(files.map((file) => [file, new Set()]));
  const dangling = new Map();
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    sources.set(file, source);
    for (const match of source.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(file, match[1], known);
      if (target && target !== file) dependents.get(target).add(file);
      else if (!target) {
        const base = specifierBase(file, match[1]);
        if (base !== null) {
          const key = base.replace(/\.(m|c)?[jt]sx?$/, "").replace(/\/index$/, "");
          if (!dangling.has(key)) dangling.set(key, new Set());
          dangling.get(key).add(file);
        }
      }
    }
  }
  return { files, sources, dependents, dangling };
}

/**
 * The unit test files `changed` can affect: changed test files, every test
 * that imports a changed file directly or through other files, and, for files
 * that aren't imported (fixtures, docs, workflow YAML a test reads), tests
 * that name the file's path. `isUnitTest` decides which test files belong to
 * the unit suite.
 *
 * @param {string} root
 * @param {string[]} changed
 * @param {(file: string) => boolean} isUnitTest
 * @param {ReturnType<typeof importGraph>} [graph]
 * @returns {{ tests: string[], unmapped: string[] }}
 */
export function affectedTests(root, changed, isUnitTest, graph = importGraph(root)) {
  const tests = new Set();
  const unmapped = [];
  for (const file of changed) {
    const deleted = !existsSync(path.join(root, file));
    if (deleted && !CODE_FILE.test(file)) {
      unmapped.push(file);
      continue;
    }
    if (!deleted && TEST_FILE.test(file) && isUnitTest(file)) tests.add(file);
    // A deleted file has no edges left: start from the files whose imports still name it.
    const importers = deleted ? [...(graph.dangling.get(file.replace(CODE_FILE, "").replace(/\/index$/, "")) ?? [])] : [];
    for (const importer of importers) if (TEST_FILE.test(importer) && isUnitTest(importer)) tests.add(importer);
    if (deleted && !importers.length) continue;
    const queue = deleted ? importers : [file];
    const seen = new Set(queue);
    let reached = importers.some((importer) => TEST_FILE.test(importer));
    while (queue.length) {
      const next = queue.shift();
      for (const dependent of graph.dependents.get(next) ?? []) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        queue.push(dependent);
        if (TEST_FILE.test(dependent) && isUnitTest(dependent)) {
          tests.add(dependent);
          reached = true;
        }
      }
    }
    if (!reached && !TEST_FILE.test(file)) {
      const named = [...graph.sources].filter(([test, source]) => TEST_FILE.test(test) && isUnitTest(test) && (source.includes(file) || source.includes(`@/${file.replace(CODE_FILE, "")}`)));
      named.forEach(([test]) => tests.add(test));
      if (!named.length) unmapped.push(file);
    }
  }
  return { tests: [...tests].sort(), unmapped };
}

/** Files whose lint result can change: changed lintable files that still exist. */
export function lintTargets(root, changed) {
  return changed.filter((file) => LINTED_FILE.test(file) && existsSync(path.join(root, file)));
}

/**
 * Whether a change can change the typecheck result: any TypeScript or
 * JavaScript file (tsconfig has allowJs, so .ts files import types from .mjs
 * JSDoc), declaration or config change.
 *
 * @param {string[]} changed
 */
export function invalidatesTypecheck(changed) {
  return changed.some((file) => /\.(tsx?|mts|cts|[cm]?jsx?)$/.test(file) || /(^|\/)tsconfig.*\.json$/.test(file) || file === "package.json" || file === "pnpm-lock.yaml");
}

/* ------------------------------------------------------------------ */
/* Reading results                                                     */
/* ------------------------------------------------------------------ */

/** Test counts and failures from Vitest's JSON report, or null if it was not written. */
export function readVitestReport(file, root) {
  if (!existsSync(file)) return null;
  let report;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const rel = (name) => posix(path.relative(root, name));
  const failures = [];
  for (const result of report.testResults ?? []) {
    const failed = (result.assertionResults ?? []).filter((test) => test.status === "failed");
    if (result.status === "failed" || failed.length) {
      failures.push({
        file: rel(result.name),
        tests: failed.map((test) => test.fullName ?? test.title),
        // A file that fails to load reports its error here, with no test results.
        message: failed.length ? undefined : result.message?.split("\n")[0],
      });
    }
  }
  return {
    files: (report.testResults ?? []).length,
    failedFiles: failures.length,
    tests: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    testFiles: (report.testResults ?? []).map((result) => rel(result.name)),
    failures,
  };
}

/** Problem counts and failing files from ESLint's default output. */
export function readEslintLog(text) {
  const totals = /✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/.exec(text);
  const files = [...text.matchAll(/^((?:[A-Za-z]:[\\/]|\/)[^\n]+?\.[cm]?[jt]sx?)\s*$/gm)].map((match) => match[1]);
  return { problems: totals ? Number(totals[1]) : 0, errors: totals ? Number(totals[2]) : 0, warnings: totals ? Number(totals[3]) : 0, files };
}

/** Error count and files from tsc's output. */
export function readTscLog(text) {
  const errors = [...text.matchAll(/^(.+?)\(\d+,\d+\): error TS\d+/gm)];
  return { errors: errors.length, files: [...new Set(errors.map((match) => posix(match[1].trim())))] };
}

/**
 * Test files from a discovery listing that sit in nested checkouts or other excluded places.
 *
 * @param {string[]} files
 * @param {string} root
 */
export function misplacedTestFiles(files, root) {
  return files.map((file) => posix(path.isAbsolute(file) ? path.relative(root, file) : file)).filter((file) => file.startsWith("..") || /(^|\/)(node_modules|\.claude|\.worktrees|\.next|\.git)\//.test(file));
}

/* ------------------------------------------------------------------ */
/* Servers                                                             */
/* ------------------------------------------------------------------ */

/** One health request with its own timeout. Never throws. */
export async function probe(url, timeoutMs = 3_000) {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    await response.arrayBuffer().catch(() => undefined);
    return { ok: response.status === 200, status: response.status, ms: Date.now() - started };
  } catch (error) {
    const cause = error?.cause?.code ?? error?.name ?? "error";
    return { ok: false, status: null, error: cause === "TimeoutError" ? `no answer within ${timeoutMs}ms` : String(cause), ms: Date.now() - started };
  }
}

/**
 * Polls `url` until it answers 200, the `child` (if any) exits, or
 * `timeoutMs` passes. Returns { ready, seconds, attempts, last, exited }.
 *
 * @param {{ url: string, timeoutMs: number, intervalMs?: number, requestTimeoutMs?: number, child?: import("node:child_process").ChildProcess }} options
 * @returns {Promise<{ ready: boolean, seconds: number, attempts: number, last: { ok: boolean, status: number | null, error?: string, ms: number } | null, exited: { code: number | null, signal: string | null } | null }>}
 */
export async function waitForReady({ url, timeoutMs, intervalMs = 1_000, requestTimeoutMs = 3_000, child }) {
  const started = Date.now();
  let attempts = 0;
  let last = null;
  let exited = null;
  const onExit = (code, signal) => (exited = { code, signal });
  child?.once("exit", onExit);
  try {
    while (Date.now() - started < timeoutMs) {
      if (exited) break;
      attempts += 1;
      last = await probe(url, Math.min(requestTimeoutMs, Math.max(250, timeoutMs - (Date.now() - started))));
      if (last.ok) return { ready: true, seconds: (Date.now() - started) / 1000, attempts, last, exited };
      const wait = Math.min(intervalMs, timeoutMs - (Date.now() - started));
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    return { ready: false, seconds: (Date.now() - started) / 1000, attempts, last, exited };
  } finally {
    child?.off("exit", onExit);
  }
}

/**
 * Starts a long-running server with all its output in `logFile`.
 *
 * @param {{ command: string, args: string[], cwd: string, env: Record<string, string | undefined>, logFile: string }} options
 */
export function startServer({ command, args, cwd, env, logFile }) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile);
  log.write(`$ ${[command, ...args].join(" ")}\n# started ${new Date().toISOString()}\n\n`);
  const child = spawn(command, args, { ...spawnOptions(cwd, env), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => log.write(chunk));
  child.stderr.on("data", (chunk) => log.write(chunk));
  child.on("error", (error) => log.write(`\n# could not start: ${error.message}\n`));
  return {
    child,
    logFile,
    async stop() {
      await stopTree(child);
      await new Promise((resolve) => log.end(`\n# stopped ${new Date().toISOString()}\n`, resolve));
    },
  };
}

/** The last `count` lines of a file, for a diagnostic; the full file stays where it is. */
export function tail(file, count = 40) {
  if (!existsSync(file)) return "(no log written)";
  const lines = readFileSync(file, "utf8").trimEnd().split(/\r?\n/);
  return lines.slice(-count).join("\n");
}

/** Seconds as a short duration: 4.2s, 1m 05s. */
export function duration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}

/** The file's modification time in ms, or 0. */
export function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
