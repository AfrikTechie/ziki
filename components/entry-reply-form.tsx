"use client";

import { useId, useState, useTransition } from "react";
import { addCommentAction } from "@/app/actions/issues";
import { COMMENT_MAX_CHARS } from "@/lib/validations/issue";

/**
 * What a reply is under: a stage entry (a confirmation, a bid, a test verdict
 * or a merge review), or a comment on the issue itself.
 */
export type ReplyTarget =
  | { confirmationId: string }
  | { bidId: string }
  | { deliveryId: string }
  | { testVerdictId: string }
  | { mergeReviewId: string }
  | { planId: string }
  | { parentId: string };

/**
 * A plain reply to one stage entry: a confirmation (#issue-confirmations),
 * a bid (#issue-bids), a delivery (#delivered-step), a test verdict or a merge review (#review-entries), or
 * to a comment on the issue itself. Replies carry no type or verdict.
 *
 * `icon` shows the closed form as a reply icon in the entry's top-right
 * corner (the entry must be `relative`) instead of a "Reply" link.
 */
export function EntryReplyForm({ bugId, target, label, icon = false, variant = "link" }: {
  bugId: string;
  target: ReplyTarget;
  label: string;
  icon?: boolean;
  /** "action": a Reply button with its icon in a comment's line of actions; the open form takes the whole line below. */
  variant?: "link" | "action";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open && icon) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Reply"
        title="Reply"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-zk-accent hover:bg-zk-chip print:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
      </button>
    );
  }

  if (!open && variant === "action") {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-xs font-semibold text-zk-muted hover:bg-zk-chip hover:text-zk-text print:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        Reply
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 text-xs font-bold text-zk-accent hover:underline print:hidden"
      >
        Reply
      </button>
    );
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!body.trim()) return setError("Write a reply first.");
    const data = new FormData();
    data.set("body", body);
    for (const [key, value] of Object.entries(target)) data.set(key, value);
    startTransition(async () => {
      const result = await addCommentAction(bugId, data);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody("");
      setOpen(false);
    });
  };

  return (
    <form onSubmit={onSubmit} aria-label={label} className={`mt-2 flex flex-col gap-1.5 print:hidden ${variant === "action" ? "order-last w-full basis-full" : ""}`}>
      <label htmlFor={`${id}-reply`} className="sr-only">
        Reply
      </label>
      <textarea
        id={`${id}-reply`}
        // Opened by tapping Reply, so typing can start at once.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        name="body"
        rows={2}
        maxLength={COMMENT_MAX_CHARS}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong"
      />
      {error ? (
        <p role="alert" className="m-0 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 items-center rounded-full bg-electric-blue-strong px-3.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Reply"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium text-zk-text2 hover:bg-zk-chip"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
