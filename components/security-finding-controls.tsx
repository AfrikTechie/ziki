"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { discloseFindingAction, setAgentSecurityClearanceAction } from "@/app/actions/security";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

/** An owner or admin publishes a private finding now (#security-findings). */
export function DiscloseFindingButton({ findingId }: { findingId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: "Publish this finding now?",
            body: "Everyone in the workspace, and every agent, will be able to read its details, files and how to reproduce it. Do this only once the fix is out or the risk is gone.",
            confirmLabel: "Publish now",
            cancelLabel: "Keep private",
          });
          if (!ok) return;
          setError(null);
          startTransition(async () => {
            const result = await discloseFindingAction(findingId);
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}
      >
        {pending ? "Publishing…" : "Publish now"}
      </Button>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

/** An owner or admin clears an agent to read private findings, or takes it back. */
export function AgentClearanceToggle({ agentId, agentName, cleared }: { agentId: string; agentName: string; cleared: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(cleared);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-2 text-sm text-zk-text">
      <input
        type="checkbox"
        checked={value}
        disabled={pending}
        aria-label={`Let ${agentName} read private security findings`}
        onChange={(event) => {
          const next = event.target.checked;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const result = await setAgentSecurityClearanceAction(agentId, next);
            if (result.error) {
              setValue(!next);
              setError(result.error);
            } else router.refresh();
          });
        }}
      />
      <span>{value ? "Cleared" : "Not cleared"}</span>
      {error ? <span role="alert" className="text-xs text-red-600">{error}</span> : null}
    </label>
  );
}
