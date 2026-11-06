import "server-only";
import type { GitHubClient } from "@/lib/github/client";
import type { PullRequestRef } from "@/lib/github/pull-request-url";
import type { PullRequestSnapshot, SnapshotCheck, SnapshotReview } from "@/lib/github/snapshot-types";

/**
 * Reads one pull request on GitHub into a `PullRequestSnapshot`
 * (#github-status): the pull request itself, every check run and commit status
 * on its head commit, the latest review from each reviewer, and how far its
 * branch is behind its base. The snapshot is what Ziki stores on its own
 * pull request report (`PullRequestReport.details`) and what
 * lib/github/merge-blockers.ts explains.
 */

type GhUser = { login: string } | null;

type GhPull = {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  draft?: boolean;
  merged: boolean;
  merged_at: string | null;
  merged_by?: GhUser;
  merge_commit_sha: string | null;
  mergeable: boolean | null;
  mergeable_state: string;
  maintainer_can_modify?: boolean;
  user: GhUser;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { ref: string; sha: string; repo: { full_name: string; default_branch: string } };
  requested_reviewers?: { login: string }[];
  requested_teams?: { slug: string }[];
};

type GhCheckRun = {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: string | null;
  html_url: string | null;
  details_url: string | null;
  app?: { slug?: string } | null;
  output?: { title?: string | null; summary?: string | null } | null;
};

type GhStatus = {
  context: string;
  state: "error" | "failure" | "pending" | "success";
  target_url: string | null;
  description: string | null;
};

type GhReview = {
  user: GhUser;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  html_url: string;
  submitted_at: string | null;
  body: string | null;
};

type GhCompare = { status: "diverged" | "ahead" | "behind" | "identical"; ahead_by: number; behind_by: number };

const repoPath = (ref: PullRequestRef) => `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;

const trim = (text: string | null | undefined, max: number) => {
  const value = (text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/** The GitHub Actions run behind a check, from its link (…/actions/runs/{id}/job/{job}). */
export function actionsRunId(url: string | null | undefined): number | null {
  const match = url ? /\/actions\/runs\/(\d+)/.exec(url) : null;
  return match ? Number(match[1]) : null;
}

function checkFromRun(run: GhCheckRun): SnapshotCheck {
  const url = run.html_url ?? run.details_url;
  let status: SnapshotCheck["status"];
  if (run.status !== "completed") status = "pending";
  else if (run.conclusion === "success" || run.conclusion === "neutral") status = "passing";
  else if (run.conclusion === "skipped") status = "skipped";
  else status = "failing"; // failure, cancelled, timed_out, action_required, stale, startup_failure
  return {
    name: run.name,
    kind: "check",
    status,
    conclusion: run.status === "completed" ? run.conclusion : run.status,
    url,
    summary: trim(run.output?.title || run.output?.summary, 200) || null,
    actionsRunId: run.app?.slug === "github-actions" ? actionsRunId(run.details_url ?? run.html_url) : null,
  };
}

function checkFromStatus(status: GhStatus): SnapshotCheck {
  return {
    name: status.context,
    kind: "status",
    status: status.state === "success" ? "passing" : status.state === "pending" ? "pending" : "failing",
    conclusion: status.state,
    url: status.target_url,
    summary: trim(status.description, 200) || null,
    actionsRunId: null,
  };
}

/** All checks passing, any failing, any still running, or none. */
export function checksSummary(checks: readonly SnapshotCheck[]): PullRequestSnapshot["checksSummary"] {
  const counted = checks.filter((check) => check.status !== "skipped");
  if (counted.length === 0) return "none";
  if (counted.some((check) => check.status === "failing")) return "failing";
  if (counted.some((check) => check.status === "pending")) return "pending";
  return "passing";
}

/** Each reviewer's latest review that counts (approve, request changes or dismissed). */
export function latestReviews(reviews: readonly GhReview[]): SnapshotReview[] {
  const byUser = new Map<string, SnapshotReview>();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login || review.state === "PENDING") continue;
    // A plain comment never replaces an approval or a change request.
    if (review.state === "COMMENTED" && byUser.has(login)) continue;
    byUser.set(login, {
      login,
      state: review.state,
      url: review.html_url,
      submittedAt: review.submitted_at,
      body: trim(review.body, 600) || null,
    });
  }
  return [...byUser.values()];
}

async function pages<T>(client: GitHubClient, path: string, pick: (page: unknown) => T[], maxPages = 3): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = pick(await client.get<unknown>(`${path}${separator}per_page=100&page=${page}`));
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

/** One read of the pull request on GitHub. A pull request GitHub doesn't know comes back as `not_found`. */
export async function readPullRequest(client: GitHubClient, ref: PullRequestRef, now = new Date()): Promise<PullRequestSnapshot> {
  const repo = repoPath(ref);
  let pull = await client.getOrNull<GhPull>(`${repo}/pulls/${ref.number}`);
  if (!pull) {
    return notFoundSnapshot(ref, now);
  }
  // GitHub works out `mergeable` in the background after a push; ask once more.
  if (pull.state === "open" && pull.mergeable === null) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    pull = (await client.getOrNull<GhPull>(`${repo}/pulls/${ref.number}`)) ?? pull;
  }

  const head = encodeURIComponent(pull.head.sha);
  const [runs, combined, reviews, compare] = await Promise.all([
    pages<GhCheckRun>(client, `${repo}/commits/${head}/check-runs`, (page) => (page as { check_runs: GhCheckRun[] }).check_runs),
    client.getOrNull<{ statuses: GhStatus[] }>(`${repo}/commits/${head}/status`),
    pages<GhReview>(client, `${repo}/pulls/${ref.number}/reviews`, (page) => page as GhReview[]),
    pull.state === "open"
      ? client.getOrNull<GhCompare>(`${repo}/compare/${encodeURIComponent(pull.base.ref)}...${head}`)
      : Promise.resolve(null),
  ]);

  // A check re-run keeps the old runs: the newest run of each name counts.
  const newestRuns = new Map<string, GhCheckRun>();
  for (const run of runs) {
    const seen = newestRuns.get(run.name);
    if (!seen || run.id > seen.id) newestRuns.set(run.name, run);
  }
  const checks: SnapshotCheck[] = [
    ...[...newestRuns.values()].map(checkFromRun),
    ...(combined?.statuses ?? []).map(checkFromStatus),
  ].sort((a, b) => order(a.status) - order(b.status) || a.name.localeCompare(b.name));

  const defaultBranch = pull.base.repo.default_branch;
  let inDefaultBranch: boolean | null = null;
  if (pull.merged) {
    if (pull.base.ref === defaultBranch) inDefaultBranch = true;
    else if (pull.merge_commit_sha) {
      const released = await client.getOrNull<GhCompare>(
        `${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(pull.merge_commit_sha)}`,
      );
      inDefaultBranch = released ? released.status === "behind" || released.status === "identical" : null;
    }
  }

  return {
    fetchedAt: now.toISOString(),
    url: pull.html_url,
    number: pull.number,
    title: pull.title,
    author: pull.user?.login ?? null,
    state: pull.merged ? "merged" : pull.state,
    draft: Boolean(pull.draft),
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state,
    headSha: pull.head.sha,
    headRef: pull.head.ref,
    headRepo: pull.head.repo?.full_name ?? null,
    baseRef: pull.base.ref,
    defaultBranch,
    behindBy: compare?.behind_by ?? null,
    aheadBy: compare?.ahead_by ?? null,
    maintainerCanModify: pull.maintainer_can_modify ?? null,
    mergedAt: pull.merged_at,
    mergedBy: pull.merged_by?.login ?? null,
    mergeCommitSha: pull.merged ? pull.merge_commit_sha : null,
    inDefaultBranch,
    checks,
    checksSummary: checksSummary(checks),
    reviews: latestReviews(reviews),
    requestedReviewers: [
      ...(pull.requested_reviewers ?? []).map((reviewer) => reviewer.login),
      ...(pull.requested_teams ?? []).map((team) => `team:${team.slug}`),
    ],
  };
}

function order(status: SnapshotCheck["status"]): number {
  return { failing: 0, pending: 1, passing: 2, skipped: 3 }[status];
}

function notFoundSnapshot(ref: PullRequestRef, now: Date): PullRequestSnapshot {
  return {
    fetchedAt: now.toISOString(),
    url: `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
    number: ref.number,
    title: null,
    author: null,
    state: "not_found",
    draft: false,
    mergeable: null,
    mergeableState: "unknown",
    headSha: null,
    headRef: null,
    headRepo: null,
    baseRef: null,
    defaultBranch: null,
    behindBy: null,
    aheadBy: null,
    maintainerCanModify: null,
    mergedAt: null,
    mergedBy: null,
    mergeCommitSha: null,
    inDefaultBranch: null,
    checks: [],
    checksSummary: "none",
    reviews: [],
    requestedReviewers: [],
  };
}
