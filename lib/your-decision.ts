import { closeReasonLabel, isReopenable, ownsIssue } from "@/lib/close-reasons";
import { formatIssueNumber } from "@/lib/issue-number";

/**
 * A decision other people made about your work (#your-decisions). When other
 * members' votes close an issue, the person it belongs to (its reporter, or
 * the person it is for) sees on the issue what was decided, who decided it,
 * why and with what evidence, is told by a notification, and can agree or
 * answer it with their evidence, which the voters are told about. Kept free of
 * database imports so the page and the close path can both use it.
 */

export type DecisionVoter = { by: string; agentName: string | null; votes: number; summary: string };

export type YourDecision = {
  /** "Your issue was closed as a duplicate of #9 Resources tabs are empty". */
  headline: string;
  reason: string;
  /** The weighted votes for the reason the issue closed with, from people other than the owner. */
  voters: DecisionVoter[];
  votes: number;
  threshold: number;
  /** The first voter's own words. */
  why: string | null;
  evidence: string | null;
  decidedAt: Date | string | null;
  /** When the owner said they agree with it; the card folds away. */
  agreedAt: Date | string | null;
  /** Only a not-reproducible close can be reopened, by a manager agent with a fresh reproduction. */
  reopenable: boolean;
};

export type DecisionIssue = {
  status: string;
  isDeleted: boolean;
  reporterId: string;
  beneficiaryUserId: string | null;
  closeReason: string | null;
  closeEvidence: string | null;
  closeAgreedAt?: Date | string | null;
  duplicateOf: { number: number; title: string } | null;
};

export type DecisionSuggestion = {
  reason: string;
  votes: number;
  summary: string;
  evidence: string | null;
  onBehalfOfUserId: string;
  by: string;
  agentName: string | null;
};

/** "Your issue was closed as a duplicate of #9 Title", or "Your issue was closed as not planned". */
export function decisionHeadline(reason: string | null, duplicateOf: { number: number; title?: string | null } | null): string {
  if (reason === "duplicate" && duplicateOf) {
    const title = duplicateOf.title ? ` ${duplicateOf.title}` : "";
    return `Your issue was closed as a duplicate of ${formatIssueNumber(duplicateOf.number)}${title}`;
  }
  const label = closeReasonLabel(reason);
  return label ? `Your issue was closed as ${label}` : "Your issue was closed";
}

/**
 * The decision card for `viewerId`, or null when there is none to show: the
 * issue must be closed by votes (not withdrawn, not deleted), belong to the
 * viewer, and at least one other person must have voted for the reason it
 * closed with. Your own vote never counts as someone deciding for you.
 */
export function decisionFor(input: {
  issue: DecisionIssue;
  viewerId: string;
  suggestions: readonly DecisionSuggestion[];
  threshold: number;
  decidedAt: Date | string | null;
}): YourDecision | null {
  const { issue, viewerId } = input;
  if (issue.isDeleted || issue.status !== "closed" || !issue.closeReason || issue.closeReason === "withdrawn") return null;
  if (!ownsIssue(issue, viewerId)) return null;
  const others = input.suggestions.filter(
    (suggestion) => suggestion.reason === issue.closeReason && suggestion.onBehalfOfUserId !== viewerId,
  );
  if (others.length === 0) return null;
  return {
    headline: decisionHeadline(issue.closeReason, issue.duplicateOf),
    reason: issue.closeReason,
    voters: others.map(({ by, agentName, votes, summary }) => ({ by, agentName, votes, summary })),
    votes: others.reduce((sum, suggestion) => sum + suggestion.votes, 0),
    threshold: input.threshold,
    why: others[0].summary || null,
    evidence: issue.closeEvidence ?? others[0].evidence,
    decidedAt: input.decidedAt,
    agreedAt: issue.closeAgreedAt ?? null,
    reopenable: isReopenable(issue.closeReason),
  };
}

/**
 * The note on the notification sent when other people's votes close an
 * issue: what was decided, by how many votes, and the evidence, so the owner
 * learns it without having to open the issue.
 */
export function decisionNote(input: {
  reason: string;
  duplicateOf: { number: number; title?: string | null } | null;
  votes: number | undefined;
  threshold: number | undefined;
  evidence: string | null;
}): string {
  const tally = input.votes !== undefined && input.threshold !== undefined ? ` by ${input.votes} of ${input.threshold} votes` : "";
  const lines = [`${decisionHeadline(input.reason, input.duplicateOf)}${tally}.`];
  if (input.evidence) lines.push(`Evidence: ${input.evidence}`);
  lines.push("Open the issue to see who decided and why. If you disagree, respond there with your evidence: the voters are told.");
  return lines.join("\n");
}
