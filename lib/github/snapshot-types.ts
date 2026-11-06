/**
 * A pull request as Ziki read it on GitHub (#github-status). Stored as JSON on
 * Ziki's own pull request reports (`PullRequestReport.details`), so it is
 * plain data: no Dates, no class instances. Shared by the server reader and
 * the issue page.
 */

export type SnapshotCheck = {
  name: string;
  /** A check run (GitHub Actions and other apps) or a commit status (older CI integrations). */
  kind: "check" | "status";
  status: "passing" | "failing" | "pending" | "skipped";
  /** GitHub's own word: "failure", "timed_out", "in_progress", … */
  conclusion: string | null;
  /** Where its logs are. */
  url: string | null;
  /** GitHub's one-line output for it, when it gave one. */
  summary: string | null;
  /** The GitHub Actions run behind it, which Ziki can re-run; null for other CI. */
  actionsRunId: number | null;
};

export type SnapshotReview = {
  login: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  url: string;
  submittedAt: string | null;
  body: string | null;
};

export type PullRequestSnapshot = {
  /** When Ziki read it (ISO). */
  fetchedAt: string;
  url: string;
  number: number;
  title: string | null;
  author: string | null;
  state: "open" | "closed" | "merged" | "not_found";
  draft: boolean;
  /** GitHub's answer: false means it conflicts; null means GitHub hasn't worked it out yet. */
  mergeable: boolean | null;
  /** GitHub's `mergeable_state`: clean, dirty, blocked, behind, unstable, has_hooks, draft or unknown. */
  mergeableState: string;
  headSha: string | null;
  headRef: string | null;
  /** owner/repo of the head branch: differs from the base repository for a fork. */
  headRepo: string | null;
  baseRef: string | null;
  defaultBranch: string | null;
  /** Commits on the base branch the pull request branch doesn't have. */
  behindBy: number | null;
  aheadBy: number | null;
  /** For a fork: whether maintainers (and so Ziki) may push to its branch. */
  maintainerCanModify: boolean | null;
  mergedAt: string | null;
  mergedBy: string | null;
  mergeCommitSha: string | null;
  /** Merged and the default branch contains it. */
  inDefaultBranch: boolean | null;
  checks: SnapshotCheck[];
  checksSummary: "passing" | "failing" | "pending" | "none";
  /** Each reviewer's latest review that counts. */
  reviews: SnapshotReview[];
  /** Reviewers (and `team:slug` teams) GitHub is still waiting on. */
  requestedReviewers: string[];
};

/** A stored snapshot read back from JSON, or null when it isn't one. */
export function asSnapshot(value: unknown): PullRequestSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<PullRequestSnapshot>;
  if (typeof snapshot.fetchedAt !== "string" || typeof snapshot.state !== "string" || !Array.isArray(snapshot.checks)) return null;
  return snapshot as PullRequestSnapshot;
}
