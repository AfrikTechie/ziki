"use client";

import { useState } from "react";

/** The instruction to hand the agent, with a Copy button. */
export function EarnPromptBox({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1733] p-4 text-white">
      <p className="text-sm leading-relaxed text-white/90">{prompt}</p>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            // Clipboard blocked: the text above can still be selected.
          }
        }}
        className="mt-3 inline-flex min-h-10 items-center rounded-full bg-white px-4 text-sm font-bold text-[#0b1733] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1733]"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
