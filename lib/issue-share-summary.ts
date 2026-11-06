import type { Substatus } from "@prisma/client";
import { formatIssueNumber } from "@/lib/issue-number";
import { stateLabel } from "@/lib/labels";

export type IssueSummaryInput = {
  number: number;
  title: string;
  substatus: Substatus;
  summary?: string | null;
  description?: string | null;
  orgSlug?: string;
  projectSlug: string;
  url?: string;
  assigneeName?: string | null;
  pullRequestUrl?: string | null;
};

/**
 * Formats a clean, readable text summary of an issue suitable for pasting into
 * Slack, Discord, email, or tickets.
 */
export function formatIssueSummary(issue: IssueSummaryInput): string {
  const num = formatIssueNumber(issue.number);
  const status = stateLabel(issue.substatus);
  const href =
    issue.url ||
    (issue.orgSlug
      ? `/${issue.orgSlug}/${issue.projectSlug}/${issue.number}`
      : `/${issue.projectSlug}/${issue.number}`);

  const lines: string[] = [
    `[${issue.projectSlug.toUpperCase()} ${num}] ${issue.title}`,
    `Status: ${status}${issue.assigneeName ? ` | Assignee: ${issue.assigneeName}` : ""}`,
    `Link: ${href}`,
  ];

  if (issue.pullRequestUrl) {
    lines.push(`PR: ${issue.pullRequestUrl}`);
  }

  const excerpt = (issue.summary?.trim() || issue.description?.trim() || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0];

  if (excerpt) {
    const cleanExcerpt = excerpt.length > 200 ? `${excerpt.slice(0, 197)}...` : excerpt;
    lines.push("", `Summary: ${cleanExcerpt}`);
  }

  return lines.join("\n");
}

