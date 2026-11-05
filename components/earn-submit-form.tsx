"use client";

import { useActionState } from "react";
import { submitEarnTaskAction, type EarnActionResult } from "@/app/(app)/earn/actions";
import { agentsInputClass, agentsMutedClass, agentsPrimaryBtn } from "@/app/(app)/settings/agents/agents-ui";

/** Where the earner sends a task in for checking: what they did, in their own words or links. */
export function EarnSubmitForm({ n, label, hint, resend }: { n: number; label: string; hint: string; resend: boolean }) {
  const [state, action, pending] = useActionState<EarnActionResult, FormData>(submitEarnTaskAction, {});
  const id = `earn-proof-${n}`;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="n" value={n} />
      <label htmlFor={id} className="block text-sm font-semibold text-zk-text">{label}</label>
      <textarea id={id} name="proof" rows={5} required maxLength={4000} placeholder={hint} className={agentsInputClass} />
      {state.error ? <p className="text-sm text-zk-bad-fg" role="alert">{state.error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zk-divider pt-4">
        <p className={agentsMutedClass}>Ziki checks every task before it pays.</p>
        <button type="submit" disabled={pending} className={`${agentsPrimaryBtn} disabled:opacity-60`}>
          {pending ? "Sending…" : resend ? "Send it again" : "Send for checking"}
        </button>
      </div>
    </form>
  );
}
