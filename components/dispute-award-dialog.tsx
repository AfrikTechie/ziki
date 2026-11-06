"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { openDisputeAction } from "@/app/(app)/points/disputes/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** An award the viewer may dispute on this issue: "reporter" for its reporter, "solver" for its assignee. */
export type DisputeRole = "solver" | "reporter";

const REASON_MAX = 1000;

/**
 * "Dispute award" (#entry-replies-only): the issue's reporter or assignee says
 * their points award for it is missing. It used to be a type in the comment
 * form; issues take no free-standing comments now, so it has its own button
 * and dialog. An organisation admin reviews it; it is never posted to the issue.
 */
export function DisputeAwardDialog({ bugNumber, roles }: { bugNumber: number; roles: DisputeRole[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [role, setRole] = useState<DisputeRole>(roles[0] ?? "solver");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  if (roles.length === 0) return null;

  const close = () => dialogRef.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface px-3 text-[13px] font-medium text-zk-text hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong print:hidden"
      >
        Dispute award
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="dispute-award-title"
        className="m-auto w-[min(36rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/40"
      >
        <form
          className="space-y-3 p-5 sm:p-6"
          action={() => {
            if (pending) return;
            setError(null);
            startTransition(async () => {
              const dispute = new FormData();
              dispute.set("bugNumber", String(bugNumber));
              dispute.set("kind", "missing");
              dispute.set("role", role);
              dispute.set("reason", reason);
              const result = await openDisputeAction(undefined, dispute);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setReason("");
              toast(result.message);
              close();
            });
          }}
        >
          <h2 id="dispute-award-title" className="text-[15px] font-bold text-zk-text">
            Dispute award
          </h2>
          <p className="text-[13px] text-zk-text2">
            Say your $ award for this issue is missing. An organisation admin reviews it; it isn&apos;t posted to the
            issue. For a wrong ledger entry, use the{" "}
            <Link href={`/points/disputes/new?bug=${bugNumber}`} className="font-bold text-zk-accent underline">
              disputes page
            </Link>
            .
          </p>
          {roles.length > 1 ? (
            <label className="flex items-center gap-2 text-[13px] font-semibold text-zk-text2">
              Missing award
              <select
                name="disputeRole"
                value={role}
                onChange={(event) => setRole(event.target.value as DisputeRole)}
                className="h-8 rounded-lg border border-zk-border bg-zk-surface px-2 text-[13px] text-zk-text"
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {option === "solver" ? "Solver award" : "Reporter award"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label htmlFor="dispute-reason" className="block text-[13px] font-semibold text-zk-text2">
            What&apos;s missing?
          </label>
          <textarea
            id="dispute-reason"
            name="reason"
            required
            rows={4}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={pending}
            placeholder="e.g. I resolved this on Tuesday but no solver $ appeared."
            {...(error ? { "aria-invalid": true, "aria-describedby": "dispute-reason-error" } : {})}
            className="w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-[13px] text-zk-text focus:border-electric-blue-strong focus:outline-none focus:ring-1 focus:ring-electric-blue-strong"
          />
          {error ? (
            <p id="dispute-reason-error" className="text-sm text-zk-bad-fg" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || !reason.trim()}>
              {pending ? "Opening…" : "Open dispute"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
