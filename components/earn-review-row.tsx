"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmEarnTaskAction,
  rejectEarnTaskAction,
  type EarnReviewResult,
} from "@/app/(app)/superadmin/earn/actions";

/**
 * Confirm or send back one submitted earn task. Confirming pays the earner. When a manager agent has given a
 * verdict, its pick is the highlighted button and its send-back reason is filled in, ready to edit.
 */
export function EarnReviewActions({ userId, taskKey, pay, suggest = null }: { userId: string; taskKey: string; pay: string; suggest?: { action: "confirm" | "send_back"; reason: string } | null }) {
  const [confirmState, confirm, confirming] = useActionState<EarnReviewResult, FormData>(confirmEarnTaskAction, {});
  const [rejectState, reject, rejecting] = useActionState<EarnReviewResult, FormData>(rejectEarnTaskAction, {});
  const error = confirmState.error ?? rejectState.error;
  const message = confirmState.message ?? rejectState.message;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <form action={confirm}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="taskKey" value={taskKey} />
          <Button type="submit" variant={suggest?.action === "send_back" ? "secondary" : undefined} disabled={confirming || rejecting}>
            {confirming ? "Confirming…" : `Confirm and pay ${pay}`}
          </Button>
        </form>
        <form action={reject} className="flex flex-wrap items-start gap-2">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="taskKey" value={taskKey} />
          <label htmlFor={`reason-${userId}-${taskKey}`} className="sr-only">Why it is sent back</label>
          <Input id={`reason-${userId}-${taskKey}`} name="reason" placeholder="Why it is sent back" defaultValue={suggest?.action === "send_back" ? suggest.reason : undefined} className="w-60" />
          <Button type="submit" variant={suggest?.action === "send_back" ? undefined : "secondary"} disabled={confirming || rejecting}>
            {rejecting ? "Sending back…" : "Send back"}
          </Button>
        </form>
      </div>
      {error ? <p className="text-sm text-red-800" role="alert">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-900" role="status">{message}</p> : null}
    </div>
  );
}
