import "server-only";
import { GitHubError, type GitHubClient } from "@/lib/github/client";
import type { PullRequestRef } from "@/lib/github/pull-request-url";
import type { PullRequestSnapshot } from "@/lib/github/snapshot-types";

/**
 * What Ziki can change on GitHub for a stuck pull request (#github-status).
 * Each needs write access (the project's GitHub App, or GITHUB_TOKEN) and is
 * pinned to the head commit Ziki last read, so it never acts on code nobody
 * has looked at.
 */

const repoPath = (ref: PullRequestRef) => `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;

/** Bring the base branch into the pull request branch (GitHub's "Update branch"). */
export async function updateBranch(client: GitHubClient, ref: PullRequestRef, expectedHeadSha: string): Promise<string> {
  const body = await client.send<{ message?: string }>("PUT", `${repoPath(ref)}/pulls/${ref.number}/update-branch`, {
    expected_head_sha: expectedHeadSha,
  });
  return body?.message ?? "GitHub is updating the branch.";
}

/** Re-run the failed jobs of each failed GitHub Actions run on the head commit. Returns how many runs were restarted. */
export async function rerunFailedChecks(client: GitHubClient, ref: PullRequestRef, snapshot: PullRequestSnapshot): Promise<number> {
  const runIds = [
    ...new Set(snapshot.checks.filter((check) => check.status === "failing" && check.actionsRunId).map((check) => check.actionsRunId!)),
  ];
  if (runIds.length === 0) {
    throw new GitHubError(422, "None of the failing checks are GitHub Actions runs, so Ziki can't re-run them. Re-run them in the CI that ran them.");
  }
  let restarted = 0;
  const failures: string[] = [];
  for (const runId of runIds) {
    try {
      await client.send("POST", `${repoPath(ref)}/actions/runs/${runId}/rerun-failed-jobs`);
      restarted++;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (restarted === 0) throw new GitHubError(422, failures[0] ?? "GitHub refused to re-run the checks.");
  return restarted;
}

type RepoSettings = { allow_squash_merge?: boolean; allow_merge_commit?: boolean; allow_rebase_merge?: boolean };

/** The merge method the repository allows, squash first. */
async function mergeMethod(client: GitHubClient, ref: PullRequestRef): Promise<"squash" | "merge" | "rebase"> {
  const repo = await client.getOrNull<RepoSettings>(repoPath(ref));
  if (!repo || repo.allow_squash_merge !== false) return "squash";
  if (repo.allow_merge_commit !== false) return "merge";
  return "rebase";
}

/** Merge it on GitHub, only if the head is still the commit Ziki read. */
export async function mergePullRequest(
  client: GitHubClient,
  ref: PullRequestRef,
  input: { headSha: string; title: string | null; issueNumber: number },
): Promise<{ sha: string; method: string }> {
  const method = await mergeMethod(client, ref);
  const body = await client.send<{ merged: boolean; sha: string; message: string }>("PUT", `${repoPath(ref)}/pulls/${ref.number}/merge`, {
    sha: input.headSha,
    merge_method: method,
    ...(method === "squash" && input.title ? { commit_title: `${input.title} (#${ref.number})` } : {}),
  });
  if (!body?.merged) throw new GitHubError(409, body?.message ?? "GitHub didn't merge it.");
  return { sha: body.sha, method };
}
