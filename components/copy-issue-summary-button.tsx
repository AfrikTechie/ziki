"use client";

import { useState } from "react";
import type { Substatus } from "@prisma/client";
import { useToast } from "@/components/ui/toast";
import { formatIssueSummary } from "@/lib/issue-share-summary";
import { copyText } from "@/lib/clipboard";

export type CopyIssueSummaryButtonProps = {
  issue: {
    number: number;
    title: string;
    substatus: Substatus;
    summary?: string | null;
    description?: string | null;
    orgSlug?: string;
    projectSlug: string;
    canonicalPath?: string;
    assigneeName?: string | null;
    pullRequestUrl?: string | null;
  };
  className?: string;
  onCopied?: () => void;
};

export function CopyIssueSummaryButton({
  issue,
  className = "",
  onCopied,
}: CopyIssueSummaryButtonProps) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const handleCopy = async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const path =
      issue.canonicalPath ||
      (issue.orgSlug
        ? `/${issue.orgSlug}/${issue.projectSlug}/${issue.number}`
        : `/${issue.projectSlug}/${issue.number}`);
    const url = origin ? `${origin}${path}` : path;
    const text = formatIssueSummary({ ...issue, url });

    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      toast("Issue summary copied to clipboard.");
      onCopied?.();
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast("Could not copy issue summary.", "error");
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      data-testid="copy-issue-summary"
      className={`inline-flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition hover:bg-zk-chip ${
        copied ? "text-zk-ok-fg" : "text-zk-text"
      } ${className}`}
    >
      {copied ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 shrink-0 text-zk-ok-fg"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0 text-zk-muted"
          aria-hidden="true"
        >
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
      <span>{copied ? "Copied to clipboard" : "Copy issue summary"}</span>
    </button>
  );
}

