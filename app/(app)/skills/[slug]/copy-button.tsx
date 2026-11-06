"use client";

import { useState } from "react";

export function CopyPromptButton({
  prompt,
  label = "Copy Agent System Prompt",
}: {
  prompt: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      type="button"
      className="inline-flex items-center gap-2 rounded-lg bg-zk-accent px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 active:brightness-95"
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
          <span>Copied to Clipboard!</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

export function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      type="button"
      className="rounded bg-zk-chip px-2.5 py-1 text-[11px] font-mono text-zk-muted transition hover:text-zk-text hover:bg-zk-border"
      title="Copy command"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
