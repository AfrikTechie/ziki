import { cpSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const standalone = resolve(root, ".next/standalone");
const server = resolve(standalone, "server.js");

if (!existsSync(server)) {
  console.error("Standalone server not found. Run `pnpm build` first.");
  process.exit(1);
}

// Next emits these beside the standalone bundle. The server can only serve
// page assets and public files when they are copied into its runtime tree.
const standaloneNext = resolve(standalone, ".next");
mkdirSync(standaloneNext, { recursive: true });
const staticAssets = resolve(root, ".next/static");
if (existsSync(staticAssets)) {
  cpSync(staticAssets, resolve(standaloneNext, "static"), {
    recursive: true,
    force: true,
  });
}
const publicAssets = resolve(root, "public");
if (existsSync(publicAssets)) {
  cpSync(publicAssets, resolve(standalone, "public"), {
    recursive: true,
    force: true,
  });
}

process.env.PORT ||= "3000";
process.env.HOSTNAME ||= "0.0.0.0";

const child = spawn(process.execPath, [server], {
  cwd: dirname(server),
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error("Could not start the standalone server:", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
