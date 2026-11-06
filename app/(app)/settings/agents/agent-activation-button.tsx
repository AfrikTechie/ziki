"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { activateAgentAction, deactivateAgentAction } from "./actions";
import { agentsDangerBtn, agentsPrimaryBtn } from "./agents-ui";

/**
 * Bring one of your agents into an organisation, or take it out (#user-agents).
 * Every organisation you belong to may use all your agents; you choose which
 * work where. Switched on, it works in every project there with its own key
 * for that organisation; switched off, that key stops and its work there is
 * handed back.
 */
export function AgentActivationButton({
  agentId,
  agentName,
  organisationId,
  organisationName,
  active,
  className,
}: {
  agentId: string;
  agentName: string;
  organisationId: string;
  organisationName: string;
  active: boolean;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  async function toggle() {
    if (active) {
      const ok = await confirm({
        title: `Take ${agentName} out of ${organisationName}?`,
        body: "Its key for this organisation stops working and any work it holds here is handed back. It keeps working in your other organisations.",
        confirmLabel: "Take it out",
        tone: "danger",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const result = active ? await deactivateAgentAction(agentId, organisationId) : await activateAgentAction(agentId, organisationId);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast(active ? `${agentName} no longer works in ${organisationName}.` : `${agentName} now works in ${organisationName}. Copy its key to connect it here.`);
      router.refresh();
    });
  }

  return (
    <button type="button" onClick={toggle} disabled={pending} className={className ?? (active ? agentsDangerBtn : agentsPrimaryBtn)}>
      {pending ? (active ? "Taking it out…" : "Bringing it in…") : active ? "Take out" : `Bring into ${organisationName}`}
    </button>
  );
}
