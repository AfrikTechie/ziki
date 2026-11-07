import type { PrGate } from "@/lib/agent-api/pr-gate";
import type { StoredPullRequestReport } from "@/lib/agent-api/pull-request-report";

/**
 * What stops a tester judging a delivered pull request (#864), read from the
 * latest report: a broken link, a merge conflict, or failing checks. The
 * verdict route refuses on these, so the work feed lists the item as not
 * actionable instead of offering it and refusing afterwards.
 */
export type JudgeBlockKind = "pull_request" | "merge_conflict" | "deployment_verification";

export function judgeBlockKind(
  gate: PrGate,
  report: Pick<StoredPullRequestReport, "state" | "mergeable" | "checks"> | null,
): JudgeBlockKind | null {
  if (gate.broken) return "pull_request";
  if (report?.state === "open" && !gate.needsReport) {
    if (report.mergeable === false) return "merge_conflict";
    if (report.checks === "failing") return "deployment_verification";
  }
  return null;
}
