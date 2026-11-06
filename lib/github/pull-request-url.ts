/**
 * GitHub addresses, read from the URL alone. Agents and Ziki (#github-status, lib/github/sync.ts) read GitHub;
 * check pull requests there and report what they saw
 * (`POST /api/v1/issues/{id}/pull-request-status`, lib/agent-api/pull-request-report.ts).
 */

export type RepoRef = { owner: string; repo: string };
export type PullRequestRef = RepoRef & { number: number };

const GITHUB_HOST = "github.com";

/** Parse `https://github.com/owner/repo(.git)` or `git@github.com:owner/repo`. */
export function parseGitHubRepoUrl(url: string | null | undefined): RepoRef | null {
  if (!url) return null;
  const trimmed = url.trim();
  const scp = /^[^@\s]+@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(trimmed);
  if (scp) return { owner: scp[1], repo: scp[2] };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== GITHUB_HOST) return null;
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2) return null;
  const [owner, repoRaw] = parts;
  const repo = repoRaw.replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** Parse `https://github.com/owner/repo/pull/123` (trailing path ignored). */
export function parsePullRequestUrl(url: string | null | undefined): PullRequestRef | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== GITHUB_HOST) return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(parsed.pathname);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/** True when two refs name the same repository (GitHub is case-insensitive). */
export function sameRepo(a: RepoRef, b: RepoRef): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();
}
