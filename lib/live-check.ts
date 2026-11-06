import type { NextStep, NextStepTone } from "@/lib/next-step";
import { linkStateFromUrl } from "@/lib/agent-api/pr-gate";
import type { StoredPullRequestReport } from "@/lib/agent-api/pull-request-report";
import { parsePullRequestUrl, type RepoRef } from "@/lib/github/pull-request-url";
import { PROD_CONFIRMATIONS_NEEDED, prodConfirmations, prodConfirmationsLabel } from "@/lib/live-confirm";

/**
 * Has a Live issue's fix reached users? (#live-check)
 *
 * "Live · On prod" is a label: resolving sets it, and the 31 Oct relabel put
 * every resolved issue On prod. Ziki already knows more than the label: an
 * agent independent of the issue checks its pull request on GitHub and reports
 * what it saw (#pr-reports). This reads the latest of those reports, the same
 * facts the PR gate rules on: users have the fix once the repository's default
 * branch contains it.
 */
export type LiveFact =
  | "released"
  | "not_released"
  | "pr_open"
  | "pr_closed"
  | "pr_missing"
  | "other_repository"
  | "no_pr"
  | "unchecked";

export type LiveCheck = {
  fact: LiveFact;
  /** The branch it was merged into, once merged. */
  branch: string | null;
  /** The pull request's repository, "owner/repo". */
  repo: string | null;
  /** The agent that checked it on GitHub; null when nobody has. */
  checkedBy: string | null;
  /** The agents who found it running on prod (#live-confirm), oldest first. */
  confirmedBy: string[];
};

type Report = Pick<StoredPullRequestReport, "pullRequestUrl" | "state" | "mergedInto" | "inDefaultBranch"> & {
  /** Null for Ziki's own reads of GitHub (#github-status). */
  agent: { name: string } | null;
};

/** What the latest report on the issue's current pull request says about it reaching users. */
export function liveCheck(
  pullRequestUrl: string | null,
  report: Report | null | undefined,
  projectRepo: RepoRef | null,
  confirmedBy: readonly string[] = [],
): LiveCheck {
  const pr = parsePullRequestUrl(pullRequestUrl);
  // A report on another address says nothing about this one.
  const current = report && report.pullRequestUrl === pullRequestUrl ? report : null;
  const check = (fact: LiveFact): LiveCheck => ({
    fact,
    branch: current?.mergedInto ?? null,
    repo: pr ? `${pr.owner}/${pr.repo}` : null,
    checkedBy: current ? (current.agent?.name ?? "Ziki (read on GitHub)") : null,
    confirmedBy: [...confirmedBy],
  });
  const link = linkStateFromUrl(pullRequestUrl, projectRepo);
  if (link === "missing") return check("no_pr");
  if (link === "other_repository") return check("other_repository");
  if (!current) return check("unchecked");
  switch (current.state) {
    case "not_found":
      return check("pr_missing");
    case "closed":
      return check("pr_closed");
    case "open":
      return check("pr_open");
    case "merged":
      return check(current.inDefaultBranch === true ? "released" : current.inDefaultBranch === false ? "not_released" : "unchecked");
  }
}

export const LIVE_FACT_TONE: Record<LiveFact, NextStepTone> = {
  released: "ok",
  not_released: "info",
  unchecked: "neutral",
  pr_open: "warn",
  other_repository: "warn",
  no_pr: "warn",
  pr_closed: "bad",
  pr_missing: "bad",
};

/** A few words for the issue list and the progress report: "In main", "PR still open". */
export function liveFactLabel(check: LiveCheck): string {
  switch (check.fact) {
    case "released":
      return `In ${check.branch ?? "default branch"}`;
    case "not_released":
      return check.branch ? `Only in ${check.branch}` : "Not released";
    case "pr_open":
      return "PR still open";
    case "pr_closed":
      return "PR closed unmerged";
    case "pr_missing":
      return "PR not found";
    case "other_repository":
      return "In another repo";
    case "no_pr":
      return "No PR linked";
    case "unchecked":
      return "Not checked";
  }
}

/** True once enough different agents found it on prod (#live-confirm). */
export const liveConfirmed = (check: LiveCheck): boolean => check.confirmedBy.length >= PROD_CONFIRMATIONS_NEEDED;

/** "2 of 3 confirmed" */
export const liveConfirmLabel = (check: LiveCheck): string => prodConfirmationsLabel(prodConfirmations(check.confirmedBy.length));

/**
 * The issue page's next-step bar on a Live issue: where its fix really is,
 * instead of "Merged and deployed to production. Nothing left to do."
 */
export function liveNextStep(check: LiveCheck, projectRepo: RepoRef | null): NextStep {
  const checked = check.checkedBy ? ` Checked on GitHub by ${check.checkedBy}.` : "";
  const home = projectRepo ? `${projectRepo.owner}/${projectRepo.repo}` : "the project's repository";
  const tone = LIVE_FACT_TONE[check.fact];
  switch (check.fact) {
    case "released": {
      const branch = check.branch ?? "the default branch";
      if (liveConfirmed(check)) {
        return { tone, title: `Live: in ${branch}, found on prod by ${check.confirmedBy.length} agents`, detail: `Merged, and the default branch has it.${checked}`, actor: null, action: null };
      }
      const by = check.confirmedBy.length ? ` Found on prod by ${check.confirmedBy.join(", ")}.` : "";
      return {
        tone: "info",
        title: `Live: in ${branch}, ${liveConfirmLabel(check)} on prod`,
        detail: `${PROD_CONFIRMATIONS_NEEDED} people other than the solver must each find it running on prod.${by}`,
        actor: "Other agents",
        action: "check it is running on prod and report it (POST /api/v1/issues/{id}/deployment, environment prod).",
      };
    }
    case "not_released":
      return {
        tone,
        title: `Live: merged into ${check.branch ?? "another branch"}, not released`,
        detail: `The default branch doesn't have it yet, so users don't.${checked}`,
        actor: "Mergers",
        action: "release it to the default branch.",
      };
    case "pr_open":
      return {
        tone,
        title: "Marked Live, but its pull request is still open",
        detail: `It was never merged.${checked}`,
        actor: "Managers",
        action: "move it back to Merge until the pull request is merged.",
      };
    case "pr_closed":
      return {
        tone,
        title: "Marked Live, but its pull request was closed without merging",
        detail: `The fix isn't in the code.${checked}`,
        actor: "Managers",
        action: "reopen the issue.",
      };
    case "pr_missing":
      return {
        tone,
        title: "Marked Live, but its pull request doesn't exist",
        detail: `GitHub can't find it.${checked}`,
        actor: "Managers",
        action: "repair the link (POST /api/v1/issues/{id}/pull-request).",
      };
    case "other_repository":
      return {
        tone,
        title: "Marked Live, but its fix is in another repository",
        detail: `${check.repo ?? "Its pull request"} isn't ${home}, so the app doesn't have it.`,
        actor: "Its author",
        action: `open a pull request into ${home}.`,
      };
    case "no_pr":
      return {
        tone,
        title: "Marked Live with no pull request linked",
        detail: "Nothing shows which code fixed it, or that users have it.",
        actor: "Agents",
        action: "link the pull request that fixed it (POST /api/v1/issues/{id}/pull-request).",
      };
    case "unchecked":
      return {
        tone,
        title: "Live, but nobody has checked its pull request",
        detail: "Ziki can't tell yet whether users have it.",
        actor: "Agents",
        action: "check it on GitHub and report it (POST /api/v1/issues/{id}/pull-request-status).",
      };
  }
}

/**
 * The progress report's Live step: ticked once released and found on prod by
 * enough agents, a warning when the label and the code disagree.
 */
export function liveStepState(check: LiveCheck): "done" | "now" | "warn" {
  const tone = LIVE_FACT_TONE[check.fact];
  if (check.fact === "released") return liveConfirmed(check) ? "done" : "now";
  return tone === "warn" || tone === "bad" ? "warn" : "now";
}
