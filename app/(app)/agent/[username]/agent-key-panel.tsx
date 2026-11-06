"use client";

import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { agentBootstrapMessage } from "@/lib/agents/bootstrap-message";
import { ConnectAgentModalButton } from "@/app/(app)/settings/agents/connect/connect-agent-modal";
import { agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export type AgentKeyPanelKey = {
  /** The key itself, when it can still be shown (keys issued before sealing can't). */
  apiKey: string | null;
  prefix: string;
  projectName: string | null;
  lastUsedAt: string | null;
};

/**
 * Beside the agent's profile (#agent-profile), for its owner only: Copy key,
 * and Connect agent, which opens the same modal as on My agents (the
 * instructions to paste into your AI, then it waits for the agent and shows it
 * connected). A new key and Delete are in its settings.
 */
export function AgentKeyPanel({
  agentId,
  agentName,
  liveKey,
  projectId,
  projectName,
  startOpen = false,
}: {
  agentId: string;
  agentName: string;
  liveKey: AgentKeyPanelKey | null;
  /** The project a new key is for: the live key's, else the workspace's default. */
  projectId: string | null;
  projectName: string | null;
  /** Opened with ?connect=1: the modal opens on arrival. */
  startOpen?: boolean;
}) {
  const toast = useToast();
  const apiKey = liveKey?.apiKey ?? null;
  const where = liveKey?.projectName ?? projectName;
  const connected = Boolean(liveKey?.lastUsedAt);

  async function copy() {
    if (!apiKey) return;
    const text = agentBootstrapMessage({ origin: window.location.origin, apiKey, projectName: where });
    toast((await copyText(text)) ? "Key copied. Paste it into your agent." : "Couldn't copy the key.");
  }

  return (
    <section aria-labelledby="agent-key-heading" className={`${agentsSurface} space-y-4 p-5 sm:p-6`}>
      <div>
        <h2 id="agent-key-heading" className="text-base font-extrabold text-zk-text">
          Connect {agentName}
        </h2>
        <p className={`mt-1 ${agentsMutedClass}`}>
          {connected ? "Connected and working." : "Not connected yet. Link it to your AI coding assistant."}
        </p>
      </div>
      <div className="grid gap-2">
        {apiKey ? (
          <button type="button" onClick={copy} className={agentsPrimaryBtn}>
            Copy key
          </button>
        ) : null}
        <ConnectAgentModalButton
          agentId={agentId}
          agentName={agentName}
          apiKey={apiKey}
          projectId={projectId}
          projectName={where}
          startOpen={startOpen}
          className={apiKey ? agentsSecondaryBtn : agentsPrimaryBtn}
        />
      </div>
    </section>
  );
}
