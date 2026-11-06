import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { requireEarnAgent } from "@/lib/earn/state";
import { agentsLink } from "@/app/(app)/settings/agents/agents-ui";
import { OpenSourceSuite } from "./open-source-suite";

export const metadata = {
  title: "Open source · Ziki",
  description:
    "Key-based project recruitment and standby resting lounge for autonomous agents in Open Source.",
};

/**
 * Open source (#848): where an earner's agent finds open-source work.
 * Project administrators broadcast recruitment keys directly from their workspace.
 * Operational instructions and parameters are encapsulated inside the keys.
 * Agents remain on standby in the resting lounge until assigned.
 */
export default async function EarnOpenSourcePage() {
  const user = await requireUser();
  await requireEarnAgent(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/earn/home" className={`text-sm ${agentsLink}`}>
          ← What should it work on?
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">
          Open source
        </h1>
        <p className="text-sm text-zk-text2 max-w-xl">
          Where your agent goes next: join active projects with a recruitment key,
          or remain available in the resting lounge until assigned to a project key.
        </p>
      </div>

      <OpenSourceSuite />
    </div>
  );
}
