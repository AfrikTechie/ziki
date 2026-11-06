"use client";

import { useActionState, useState } from "react";
import { addContactAction, setContactSentAction, submitOutreachAction, type EarnActionResult } from "@/app/(app)/earn/actions";

export type OutreachRow = { id: string; name: string; contact: string | null; link: string; sent: boolean; opened: boolean; email: string };

export function EarnCopyButton({ text, label, primary }: { text: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard blocked: nothing to do but leave the button as it was.
        }
      }}
      className={`inline-flex min-h-9 shrink-0 items-center rounded-full px-4 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${primary ? "bg-electric-blue-strong text-white hover:bg-[#2552af]" : "border border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * The email task's list (#earn-outreach): each business with its own link, its email ready to copy, and a Sent
 * tick. Send for checking unlocks once every one is ticked. The earner sends each email from their own address.
 */
export function EarnOutreach({ rows, target }: { rows: OutreachRow[]; target: number }) {
  const [addState, add, adding] = useActionState<EarnActionResult, FormData>(addContactAction, {});
  const [sendState, send, sending] = useActionState<EarnActionResult>(submitOutreachAction, {});
  const sent = rows.filter((row) => row.sent).length;
  const firstUnsent = rows.find((row) => !row.sent)?.id;
  const ready = rows.length >= target && sent >= target;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zk-text2">Send each one from your own email, then tick it.</p>
        <div className="min-w-48 text-right">
          <p className="text-xs font-bold text-zk-text">{sent} of {target} sent</p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zk-seg">
            <div className="h-full rounded-full bg-zk-ok-fg transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.min(1, sent / target) * 100}%` }} />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-zk-chip px-4 py-3 text-sm text-zk-text2">Your businesses come from the Research task. Do that one first, or add them here.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-zk-divider p-0">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
              <form action={setContactSentAction}>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="sent" value={row.sent ? "0" : "1"} />
                <button
                  type="submit"
                  aria-label={row.sent ? `Untick ${row.name}` : `Tick ${row.name} as sent`}
                  aria-pressed={row.sent}
                  className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${row.sent ? "border-zk-ok-fg bg-zk-ok-fg text-white" : "border-zk-border bg-zk-surface hover:border-zk-ok-fg"}`}
                >
                  {row.sent ? <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg> : null}
                </button>
              </form>
              <span className="min-w-0 flex-1 basis-48">
                <span className="block text-sm font-bold text-zk-text">{row.name}</span>
                <span className="block truncate text-xs text-zk-muted">{row.contact ?? "No email or website yet"}</span>
              </span>
              <span className="rounded-lg bg-zk-tint px-2 py-1 font-mono text-xs text-zk-info-fg">{row.link.replace(/^https?:\/\//, "")}</span>
              {row.opened ? <span className="rounded-full bg-zk-ok-bg px-2 py-0.5 text-xs font-bold text-zk-ok-fg">Opened</span> : null}
              <EarnCopyButton text={row.email} label="Copy email" primary={row.id === firstUnsent} />
            </li>
          ))}
        </ul>
      )}

      {rows.length < target ? (
        <form action={add} className="flex flex-wrap items-center gap-2 rounded-2xl bg-zk-chip p-3">
          <label htmlFor="outreach-name" className="sr-only">Business name</label>
          <input id="outreach-name" name="name" placeholder="Business name" className="min-h-10 flex-1 basis-40 rounded-xl border border-zk-border bg-zk-surface px-3 text-sm" />
          <label htmlFor="outreach-contact" className="sr-only">Email or website</label>
          <input id="outreach-contact" name="contact" placeholder="Email or website" className="min-h-10 flex-1 basis-40 rounded-xl border border-zk-border bg-zk-surface px-3 text-sm" />
          <button type="submit" disabled={adding} className="inline-flex min-h-10 items-center rounded-full border border-zk-border bg-zk-surface px-4 text-sm font-bold text-zk-text hover:bg-zk-bg">
            {adding ? "Adding…" : `Add (${rows.length} of ${target})`}
          </button>
          {addState.error ? <p className="w-full text-xs text-zk-bad-fg" role="alert">{addState.error}</p> : null}
        </form>
      ) : null}

      <form action={send} className="flex flex-wrap items-center justify-between gap-3 border-t border-zk-divider pt-4">
        <span className="text-xs text-zk-muted">Ziki sees who opens each link. Follow up on People you reached.</span>
        <button
          type="submit"
          disabled={!ready || sending}
          className="inline-flex min-h-11 items-center rounded-full bg-electric-blue-strong px-6 text-sm font-bold text-white transition hover:bg-[#2552af] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : ready ? "Send for checking" : `Send for checking (${Math.max(0, target - sent)} to go)`}
        </button>
        {sendState.error ? <p className="w-full text-sm text-zk-bad-fg" role="alert">{sendState.error}</p> : null}
        {sendState.message ? <p className="w-full text-sm text-zk-ok-fg" role="status">{sendState.message}</p> : null}
      </form>
    </div>
  );
}
