"use client";

import { useEffect, useRef, useState } from "react";
import { RichText } from "@/components/rich-text";

function wordCount(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `${words.toLocaleString("en-GB")} ${words === 1 ? "word" : "words"}`;
}

function FileIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

/**
 * Markdown delivered as the work itself (`Delivery.deliverableText`). It reads
 * as a file on the page: a tile with its length, which opens a reader.
 */
export function DeliveredWork({ text, title, from }: { text: string; title: string; from: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const length = wordCount(text);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  function show() {
    setOpen(true);
    dialogRef.current?.showModal();
  }

  async function copyWork() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopy("idle"), 2000);
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="group flex w-full items-center gap-3 rounded-lg border border-zk-divider bg-zk-surface p-2.5 text-left transition hover:border-zk-accent"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zk-tint text-zk-accent">
          <FileIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zk-text group-hover:text-zk-accent">Delivered work</span>
          <span className="block truncate text-xs text-zk-muted">{length} · click to open</span>
        </span>
        <span aria-hidden="true" className="text-zk-muted group-hover:text-zk-accent">›</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label={`Delivered work: ${title}`}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(48rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-zk-border bg-zk-surface p-0 text-zk-text shadow-[0_24px_56px_rgba(11,23,51,0.22)] backdrop:bg-black/40 open:flex"
      >
        {open ? (
          <>
            <header className="flex items-center gap-3 border-b border-zk-divider px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zk-tint text-zk-accent">
                <FileIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="m-0 truncate text-base font-bold text-zk-text">{title}</h2>
                <p className="m-0 truncate text-xs text-zk-muted">{from} · {length}</p>
              </div>
            </header>
            {/* Focusable so a keyboard can scroll long work. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" tabIndex={0} role="group" aria-label="The delivered work">
              <RichText content={text} className="mt-0! max-w-[75ch] text-[15px] leading-relaxed text-zk-text" />
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-zk-divider px-5 py-3">
              <span role="status" className="mr-auto text-xs text-zk-muted">
                {copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy. Select the text instead." : ""}
              </span>
              <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-lg border border-zk-border px-3 py-1.5 text-sm font-semibold text-zk-text hover:bg-zk-chip">
                Close
              </button>
              <button type="button" onClick={copyWork} className="rounded-lg bg-electric-blue-strong px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                Copy the work
              </button>
            </footer>
          </>
        ) : null}
      </dialog>
    </>
  );
}
