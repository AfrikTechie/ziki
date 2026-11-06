"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { agreeWithCloseAction, respondToCloseAction } from "@/app/actions/your-decision";

/**
 * The decision card's answers (#your-decisions): "Respond" opens a
 * box for the owner's side and evidence, posted as a comment the voters are
 * told about; "I agree" accepts the close.
 */
export function DecisionActions({ issueId, reopenable }: { issueId: string; reopenable: boolean }) {
  const router = useRouter();
  const [appealing, setAppealing] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (action: () => Promise<{ ok?: true; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
    });

  if (appealing) {
    return (
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(() => respondToCloseAction(issueId, evidence));
        }}
      >
        <label htmlFor="decision-appeal" className="text-[13px] font-semibold text-zk-text">
          Your side, with the evidence
        </label>
        <textarea
          id="decision-appeal"
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          rows={3}
          required
          placeholder="Why the decision is wrong: what they missed, a link, a screenshot, a request id…"
          className="w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-[13px] text-zk-text"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending || !evidence.trim()}
            className="rounded-full bg-electric-blue-strong px-3.5 py-1.5 text-[13px] font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            onClick={() => setAppealing(false)}
            className="rounded-full border border-zk-border bg-transparent px-3.5 py-1.5 text-[13px] font-semibold text-zk-text hover:bg-zk-chip"
          >
            Cancel
          </button>
          <span className="text-[12px] text-zk-muted">
            {reopenable
              ? "Posted on the issue; the voters are told. A manager can reopen it with your fresh reproduction."
              : "Posted on the issue as a comment; everyone who voted is told."}
          </span>
        </div>
        {error ? <p role="alert" className="m-0 text-[13px] text-zk-bad-fg">{error}</p> : null}
      </form>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAppealing(true)}
          className="rounded-full bg-electric-blue-strong px-3.5 py-1.5 text-[13px] font-bold text-white hover:opacity-90"
        >
          Respond
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => send(() => agreeWithCloseAction(issueId))}
          className="rounded-full border border-zk-border bg-transparent px-3.5 py-1.5 text-[13px] font-semibold text-zk-text hover:bg-zk-chip disabled:opacity-50"
        >
          I agree
        </button>
        <span className="text-[12px] text-zk-muted">Your evidence goes to everyone who voted.</span>
      </div>
      {error ? <p role="alert" className="m-0 mt-2 text-[13px] text-zk-bad-fg">{error}</p> : null}
    </div>
  );
}
