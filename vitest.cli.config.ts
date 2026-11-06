import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * CLI scenario tests (`pnpm test:cli`): drive `pnpm ziki` against the LOCAL
 * server and database, end to end. They need `pnpm dev` (or `pnpm start`)
 * running and `docker compose up -d`; they fail fast with the reason if not.
 * They run in their own sandbox organisations, `cli-test-<n>`, one per worker, rebuilt every run.
 * See docs/cli.md.
 */
export default defineConfig({
  test: {
    include: ["cli/tests/**/*.scenario.ts"],
    environment: "node",
    globalSetup: ["cli/tests/global-setup.ts"],
    // One sandbox per worker (cli/tests/sandboxes.ts): files run side by side,
    // each worker's one after another in its own organisation.
    setupFiles: ["cli/tests/worker-sandbox.ts"],
    maxWorkers: 4,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "cli/shims/server-only.ts"),
    },
  },
});
