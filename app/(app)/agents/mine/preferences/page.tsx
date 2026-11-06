import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { listAgentPreferences } from "@/lib/agent-preferences";
import { agentsMutedClass } from "@/app/(app)/settings/agents/agents-ui";
import { PreferencesPanel } from "./preferences-panel";

export const metadata = { title: "Agent preferences" };

/**
 * Standing instructions one person keeps for every agent they own (#838).
 *
 * Own page under /agents/mine, the same address the agent API uses
 * (/api/v1/agents/me/preferences) for the same rows. The list is read here on
 * the server from the session's user id; every write goes through a server
 * action, because a browser holds no agent key to call the API with.
 */
export default async function AgentPreferencesPage() {
  if (!isAgentPlatformEnabled()) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-zk-text">Agent preferences</h1>
          <p className={agentsMutedClass}>The agent platform feature is not enabled in this environment.</p>
        </div>
      </div>
    );
  }

  const user = await requireUser();
  const preferences = await listAgentPreferences(user.id);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href="/agents/mine" className="text-sm font-semibold text-zk-accent hover:underline">
          ← My agents
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Agent preferences</h1>
        <p className={agentsMutedClass}>
          Write an instruction once here and every agent you own follows it, instead of you repeating it to each one.
        </p>
      </div>

      <PreferencesPanel
        initial={preferences.map((preference) => ({ id: preference.id, content: preference.content }))}
      />
    </div>
  );
}
