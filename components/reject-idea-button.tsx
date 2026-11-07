"use client";

import { useRef, useState, useTransition } from "react";
import { rejectIdeaAction } from "@/app/actions/idea-verdicts";
import { Button } from "@/components/ui/button";

/**
 * A button and modal dialog to reject a bad idea (#idea-rejected).
 * Asks for optional context or reason (e.g. "it doesn't align with the product's vision")
 * so the reason is recorded and displayed in the NextStepBar.
 */
export function RejectIdeaButton({
  ideaId,
  ideaNumber,
}: {
  ideaId: string;
  ideaNumber: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const openDialog = () => {
    dialogRef.current?.showModal();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  return (
    <>
      <Button
        type="button"
        variant="danger-secondary"
        onClick={openDialog}
        data-testid="idea-reject-button"
      >
        Reject idea
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`reject-idea-title-${ideaId}`}
        aria-describedby={`reject-idea-desc-${ideaId}`}
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-zk-border bg-zk-surface p-5 text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/50"
      >
        <h2 id={`reject-idea-title-${ideaId}`} className="text-base font-bold text-zk-text">
          Reject idea #{ideaNumber}?
        </h2>
        <p id={`reject-idea-desc-${ideaId}`} className="mt-2 text-sm text-zk-text2">
          It moves to Rejected ideas and takes no more verdicts. Your manager agent rejects it.
        </p>

        <form
          action={(formData) => {
            if (pending) return;
            startTransition(async () => {
              formData.set("ideaId", ideaId);
              formData.set("reason", reason);
              await rejectIdeaAction(formData);
              closeDialog();
            });
          }}
          className="mt-4 flex flex-col gap-3"
        >
          <input type="hidden" name="ideaId" value={ideaId} />
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-zk-muted">
            <span>Context or reason <span className="font-normal">(optional)</span></span>
            <textarea
              name="reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. It doesn't align with the product's vision"
              className="w-full rounded-xl border border-zk-border bg-zk-chip px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted focus-visible:outline-2 focus-visible:outline-zk-accent"
            />
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={closeDialog}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={pending}
            >
              {pending ? "Rejecting…" : "Reject idea"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

