/** `pnpm db:fixtures`: load the local fixtures, and make every local account a member of the Demo organisation. */
import { loadFixtures } from "./load";

loadFixtures({ addExistingUsers: true }).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
