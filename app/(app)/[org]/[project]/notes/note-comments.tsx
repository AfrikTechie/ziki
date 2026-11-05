"use client";

import { useState, useTransition } from "react";
import { addNoteCommentAction } from "./actions";

/** The id the composer's text field has, for the Add note button to focus (#740). */
export const NOTE_COMPOSER_FIELD_ID = "note-comment-body";

/** A member writes a note comment (#732). An error keeps the draft. */
export function NoteCommentComposer({ projectId }: { projectId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [pending, startTransition] = useTransition();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) {
      setError("Write a note first.");
      return;
    }
    startTransition(async () => {
      const result = await addNoteCommentAction(projectId, body);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody("");
      setError(null);
      setPosted(true);
    });
  };
  return (
    <form onSubmit={submit} className="border-b border-zk-border px-5 py-4 sm:px-7">
      <label htmlFor={NOTE_COMPOSER_FIELD_ID} className="text-sm font-semibold text-zk-text">Add a note</label>
      <textarea
        id={NOTE_COMPOSER_FIELD_ID}
        value={body}
        onChange={(event) => { setBody(event.target.value); setPosted(false); }}
        rows={3}
        maxLength={10_000}
        placeholder="Something you learned about this project that would help others: a gotcha, a convention, where something lives. It doesn't change the official notes."
        className="mt-2 w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text"
        aria-describedby={error ? "note-comment-error" : undefined}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-lg bg-electric-blue-strong px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Posting…" : "Post note"}
        </button>
        {error ? <p id="note-comment-error" role="alert" className="text-sm text-zk-bad-fg">{error}</p> : null}
        {posted && !error ? <p role="status" className="text-sm text-zk-ok-fg">Posted.</p> : null}
      </div>
    </form>
  );
}

/**
 * The Notes page's Add note button (#740): it takes you to the note composer
 * with the cursor in its text field. Every member may add a note, so it always
 * shows; it doesn't edit the official notes.
 */
export function AddNoteButton() {
  const focusComposer = () => {
    const field = document.getElementById(NOTE_COMPOSER_FIELD_ID);
    if (!field) return;
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus({ preventScroll: true });
  };
  return (
    <button type="button" onClick={focusComposer} className="rounded-lg bg-electric-blue-strong px-3 py-2 text-sm font-semibold text-white hover:brightness-110">
      Add note
    </button>
  );
}

/**
 * Reply to a note (#732): a correction or an adaptation of what it learned.
 * A Reply button that opens a small form, with the cursor in it.
 */
export function NoteReplyForm({ projectId, parentId }: { projectId: string; parentId: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-xs font-semibold text-zk-muted hover:bg-zk-chip hover:text-zk-text">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        Reply
      </button>
    );
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return setError("Write a reply first.");
    startTransition(async () => {
      const result = await addNoteCommentAction(projectId, body, parentId);
      if (result.error) return setError(result.error);
      setBody("");
      setError(null);
      setOpen(false);
    });
  };
  return (
    <form onSubmit={submit} aria-label="Reply to this note" className="mt-2 flex flex-col gap-1.5">
      <textarea
        // Opened by tapping Reply, so typing can start at once.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        aria-label="Reply"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        maxLength={10_000}
        placeholder="A correction or an adaptation of this learning."
        className="w-full rounded-lg border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text"
      />
      {error ? <p role="alert" className="m-0 text-xs text-zk-bad-fg">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-electric-blue-strong px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
          {pending ? "Sending…" : "Reply"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-zk-text2 hover:bg-zk-chip">
          Cancel
        </button>
      </div>
    </form>
  );
}
