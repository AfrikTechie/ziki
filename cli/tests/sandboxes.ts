import path from "node:path";

/**
 * The scenarios run in parallel, one Vitest worker per sandbox: each worker
 * has its own `cli-test-<n>` organisation and agent keys, so a scenario never sees
 * another's issues, inbox or feed. Files in one worker still run one after
 * another, as they always did.
 */
export const CLI_TEST_WORKERS = 4;

export function sandboxFor(worker: number): { sandbox: string; keyring: string } {
  return {
    sandbox: `cli-test-${worker}`,
    keyring: path.resolve(__dirname, `../../.ziki-cli/test-agents-${worker}.json`),
  };
}
