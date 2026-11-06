import { loadDotEnv } from "../env";
import { run } from "../run";
import { loadFixtures } from "../../scripts/dev/fixtures/load";
import { CLI_TEST_WORKERS, sandboxFor } from "./sandboxes";

/**
 * Before any scenario: the local server and database must be up (fail fast
 * with the reason if not), then each worker's `cli-test-<n>` sandbox is
 * rebuilt from scratch with fresh agent keys (cli/tests/sandboxes.ts), and the
 * Demo organisation is loaded from the checked-in fixtures (scripts/dev/fixtures),
 * so every run has realistic data beside the sandboxes.
 */
export default async function setup(): Promise<void> {
  loadDotEnv();
  const lines: string[] = [];
  const io = { out: (text: string) => lines.push(text), err: (text: string) => lines.push(text) };
  // One after another: the CLI reads the sandbox and keyring from the environment.
  for (let worker = 1; worker <= CLI_TEST_WORKERS; worker++) {
    const { sandbox, keyring } = sandboxFor(worker);
    process.env.ZIKI_CLI_SANDBOX = sandbox;
    process.env.ZIKI_CLI_KEYRING = keyring;
    if ((await run(["setup", "--reset"], io)) !== 0) {
      throw new Error(`CLI tests need a local database and server.\n${lines.join("\n")}`);
    }
  }
  await loadFixtures({ quiet: true });
  if ((await run(["doctor"], io)) !== 0) {
    throw new Error(`CLI tests need the local server running (\`pnpm dev\`).\n${lines.join("\n")}`);
  }
}
