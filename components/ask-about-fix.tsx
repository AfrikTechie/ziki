"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/ui/character-counter";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { useToast } from "@/components/ui/toast";
import { SUPPORT_MESSAGE_MAX } from "@/lib/validations/support-thread";
import { createSupportThreadAction } from "@/app/actions/support-threads";

export function AskAboutFix({
  issueId,
  issueNumber,
  issueTitle,
}: {
  issueId: string;
  issueNumber: number;
  issueTitle: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [generalError, setGeneralError] = useState<string | null>(null);

  const { fieldErrors, show, clear, attrs, formId } = useFieldErrors(
    `ask-fix-${issueId}`,
    formRef,
  );

  const showModal = () => {
    setIsOpen(true);
    setBody("");
    clear();
    setGeneralError(null);
    dialogRef.current?.showModal();
  };

  const closeModal = () => {
    dialogRef.current?.close();
    setIsOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    setGeneralError(null);

    if (!body.trim()) {
      show({ field: "body", error: "Write a message before sending it." });
      return;
    }

    startTransition(async () => {
      try {
        const res = await createSupportThreadAction({ issueId, body });
        if (res.ok) {
          closeModal();
          toast(
            <span className="inline-flex items-center gap-1.5">
              <span>Request created.</span>
              <Link
                href={`/inbox?tab=requests&thread=${encodeURIComponent(res.threadId)}`}
                className="font-semibold underline hover:opacity-90"
              >
                View request →
              </Link>
            </span>,
            "success",
          );
          router.refresh();
        } else {
          setGeneralError(res.error);
        }
      } catch {
        setGeneralError("Could not submit your request. Please try again.");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={showModal}
        className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-zk-border bg-zk-surface px-3 text-xs font-semibold text-zk-text hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
      >
        <span aria-hidden="true">💬</span>
        <span>Ask about this fix</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Ask about this fix"
        onClose={() => setIsOpen(false)}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(38rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/40"
      >
        <div className="relative p-5 sm:p-6">
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-zk-muted hover:bg-zk-chip hover:text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>

          <h2 className="text-base font-extrabold text-zk-text">Ask about this fix</h2>
          <p className="mt-1 text-xs text-zk-muted">
            Got a question about a stuck fix? Your request will reach manager and merger agents in this workspace.
          </p>

          <div className="mt-3 rounded-lg border border-zk-border bg-zk-chip/40 px-3 py-2 text-xs">
            <span className="font-semibold text-zk-text">#{issueNumber}</span>{" "}
            <span className="text-zk-muted">{issueTitle}</span>
          </div>

          {isOpen ? (
            <form ref={formRef} id={formId} onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label htmlFor="support-thread-body" className="block text-xs font-semibold text-zk-text">
                  Your question
                </label>
                <Textarea
                  id="support-thread-body"
                  name="body"
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    if (fieldErrors.body) clear();
                  }}
                  placeholder="What is blocking this fix? What would you like to know?"
                  rows={4}
                  maxLength={SUPPORT_MESSAGE_MAX}
                  disabled={isPending}
                  className="mt-1 border-zk-border bg-zk-surface text-zk-text placeholder:text-zk-muted"
                  {...attrs("body")}
                />
                <div className="mt-1 flex items-center justify-between">
                  <FieldError formId={formId} field="body" errors={fieldErrors} />
                  <CharacterCounter length={body.length} max={SUPPORT_MESSAGE_MAX} className="ml-auto" />
                </div>
              </div>

              {generalError ? (
                <p role="alert" className="text-xs text-zk-bad-fg">
                  {generalError}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isPending}
                  onClick={closeModal}
                  className="rounded-full border border-zk-border bg-zk-surface px-4 py-1.5 text-xs font-semibold text-zk-text hover:bg-zk-chip"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending || !body.trim()}
                  className="rounded-full bg-electric-blue-strong px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  {isPending ? "Submitting…" : "Send request"}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

