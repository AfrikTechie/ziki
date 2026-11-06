"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAgentAction, regenerateAgentKeyAction } from "./actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { agentBootstrapMessage } from "@/lib/agents/bootstrap-message";
import { agentsDangerBtn, agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn } from "./agents-ui";

/**
 * Delete an agent: in its settings, or on the row of a revoked agent (which
 * has no settings left). Its key stops working; issues it filed stay.
 */
export function AgentDeleteButton({
  agentId,
  agentName,
  afterDelete,
}: {
  agentId: string;
  agentName: string;
  /** Where to go once it is deleted; stays on the page when left out. */
  afterDelete?: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function remove() {
    const ok = await confirm({
      title: `Delete ${agentName}?`,
      body: "The agent is removed from every organisation it works in and its keys stop working. Any offer, claim or bid it held is handed back. Issues it filed stay. This can't be undone.",
      confirmLabel: "Delete agent",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteAgentAction(agentId);
      toast(result.ok ? `${agentName} was deleted.` : result.error, result.ok ? "success" : "error");
      if (result.ok && afterDelete) router.push(afterDelete);
    });
  }

  return (
    <Button type="button" onClick={remove} disabled={pending} className={agentsDangerBtn}>
      {pending ? "Deleting…" : "Delete agent"}
    </Button>
  );
}

/**
 * A new key for the agent, in its settings: the old one stops working at once.
 * The new key is copied with the steps for the agent, like Copy key.
 */
export function AgentNewKeyButton({
  agentId,
  agentName,
  organisationName,
  hasKey,
}: {
  agentId: string;
  agentName: string;
  /** The organisation the key works in: the one you are in (#user-agents). */
  organisationName: string | null;
  hasKey: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [issued, setIssued] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function regenerate() {
    const ok = !hasKey || await confirm({
      title: `Get a new key for ${agentName}?`,
      body: "Its current key stops working straight away, so you'll need to give the new one to your agent.",
      confirmLabel: "Get a new key",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await regenerateAgentKeyAction(agentId);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      setIssued(result.rawKey);
      router.refresh();
    });
  }

  async function copy() {
    if (!issued) return;
    const text = agentBootstrapMessage({ origin: window.location.origin, apiKey: issued, organisationName });
    toast((await copyText(text)) ? "Key copied. Paste it into your agent." : "Couldn't copy the key.");
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={regenerate} disabled={pending} className={hasKey ? agentsSecondaryBtn : agentsPrimaryBtn}>
        {pending ? "Getting a key…" : hasKey ? "Get a new key" : "Get a key"}
      </Button>
      {issued ? (
        <div role="status" className="space-y-2">
          <p className={agentsMutedClass}>New key ready. Copy it and paste it into your agent.</p>
          <Button type="button" onClick={copy} className={agentsPrimaryBtn}>
            Copy key
          </Button>
        </div>
      ) : null}
    </div>
  );
}
