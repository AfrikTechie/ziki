import "server-only";
import { githubClientFor, GitHubError, type GitHubClient } from "@/lib/github/client";
import { installationIdForPullRequest } from "@/lib/github/project-repositories";
import { parseGitHubRepoUrl, parsePullRequestUrl, sameRepo, type RepoRef } from "@/lib/github/pull-request-url";
import type { DeliveryReadiness, ReadinessCheck, ReadinessProject, ReadinessRepository } from "@/lib/github/repository-readiness-types";

export type ReadinessProjectInput = {
  id: string;
  name: string;
  slug: string;
  repoUrl: string | null;
  githubInstallationId: string | null;
  repositories: { url: string; label: string | null; branch: string | null; githubInstallationId: string | null }[];
  bugs: { number: number; pullRequestUrl: string | null }[];
};

type Repository = { full_name: string; default_branch: string };
type PullRequest = { base: { ref: string; repo: { full_name: string } | null } };
const check = (key: string, state: ReadinessCheck["state"], code: string, message: string): ReadinessCheck => ({ key, state, code, message });
const repoName = (ref: RepoRef) => `${ref.owner}/${ref.repo}`;
const repoPath = (ref: RepoRef) => `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
const repoUrl = (ref: RepoRef) => `https://github.com/${repoName(ref)}`;
const validName = (value: string) => /^[\w.-]+$/.test(value) && value !== "." && value !== "..";

/** Only known GitHub URL forms become API paths or links; malformed URLs may contain credentials. */
function configuredRepo(value: string | null): RepoRef | null {
  const ref = parseGitHubRepoUrl(value);
  if (!ref || !validName(ref.owner) || !validName(ref.repo)) return null;
  if (value?.trim().startsWith("git@github.com:")) return ref;
  try {
    const url = new URL(value!);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash) return null;
    return /^\/[^/]+\/[^/]+\/?$/.test(url.pathname) ? ref : null;
  } catch { return null; }
}

function deliveryRef(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    const ref = parsePullRequestUrl(value);
    return ref && Number.isSafeInteger(ref.number) && ref.number > 0 &&
      validName(ref.owner) && validName(ref.repo) ? ref : null;
  } catch { return null; }
}

/** Never expose a remote response body, JWT, private key, or transport error to the browser. */
function failure(key: string, error: unknown): ReadinessCheck {
  const status = error instanceof GitHubError ? error.status : 0;
  if (status === 404) return check(key, "fail", "not_found_or_inaccessible", "GitHub returned 404: missing, renamed, or private and inaccessible. Check the address and installation access.");
  if (status === 401) return check(key, "fail", "authentication_failed", "GitHub authentication failed. Reconnect the installation or repair the server's GitHub App configuration.");
  if (status === 403 || status === 429) return check(key, "fail", "access_or_rate_limit", `GitHub returned ${status}: access is denied or rate limited. Check permissions and retry later.`);
  return check(key, "fail", "github_unavailable", "GitHub could not complete this check. Recheck when it is available.");
}

function purposeHint(project: ReadinessProjectInput, ref: RepoRef): ReadinessCheck[] {
  const platform = (name: string) => {
    const words = name.toLowerCase().split(/[^a-z0-9]+/);
    const found = ["mobile", "desktop"].filter((word) => words.includes(word));
    return found.length === 1 ? found[0] : null;
  };
  const expected = platform(`${project.slug} ${project.name}`);
  const actual = platform(ref.repo);
  return expected && actual && expected !== actual
    ? [check("project purpose", "warning", "possible_project_mismatch", `Project name suggests ${expected}, but its main repository is ${repoName(ref)} (${actual}). Confirm the intended repository in project settings; this is a name-based warning, not proof.`)]
    : [];
}

async function branchCheck(client: GitHubClient, ref: RepoRef, branch: string, key: string): Promise<ReadinessCheck> {
  try {
    const found = await client.getOrNull<{ name: string }>(`${repoPath(ref)}/branches/${encodeURIComponent(branch)}`);
    return found?.name === branch ? check(key, "pass", "branch_exists", `Branch ${branch} exists.`)
      : check(key, "fail", "branch_missing", `Branch ${branch} was not found. Correct the branch or grant the installation contents access.`);
  } catch (error) { return failure(key, error); }
}

async function inspectRepository(project: ReadinessProjectInput, input: { url: string | null; label: string; branch: string | null; installationId: string | null; main: boolean }): Promise<ReadinessRepository> {
  const ref = configuredRepo(input.url);
  const result: ReadinessRepository = { label: input.label, name: ref ? repoName(ref) : "Repository not configured", url: ref ? repoUrl(ref) : null, defaultBranch: null, deliveryBranch: input.branch, checks: [] };
  if (!ref) {
    result.checks.push(check("repository", "fail", "invalid_repository", "Set a valid GitHub repository address in project settings."));
    return result;
  }
  if (input.main) result.checks.push(...purposeHint(project, ref));
  let client: GitHubClient | undefined;
  let repository: Repository | null = null;
  let primaryError: unknown;
  try {
    client = await githubClientFor({ githubInstallationId: input.installationId });
    repository = await client.getOrNull<Repository>(repoPath(ref));
    if (!repository) primaryError = new GitHubError(404, "Unavailable");
  } catch (error) { primaryError = error; }

  if (primaryError) {
    result.checks.push({ ...failure("app installation", primaryError), code: "installation_check_failed" });
    // A public/token read can distinguish an existing public repo from an app
    // that lacks access. It must never turn the failed installation check green.
    try {
      client = await githubClientFor({ githubInstallationId: null });
      repository = await client.getOrNull<Repository>(repoPath(ref));
    } catch (error) {
      result.checks.push(failure("repository", error));
    }
  } else {
    result.checks.push(client?.auth === "app"
      ? check("app installation", "pass", "installation_access", "The selected GitHub App installation can read this repository.")
      : check("app installation", "warning", input.installationId ? "app_auth_unavailable" : "installation_missing", input.installationId
        ? "An installation is selected, but this read used a token or anonymous access. App access is not verified."
        : "No GitHub App installation is connected. Public/token access does not verify App access."));
  }
  if (!repository || !client) {
    if (!result.checks.some((item) => item.key === "repository")) result.checks.push(failure("repository", new GitHubError(404, "Unavailable")));
    result.checks.push(check("branches", "unknown", "not_checked", "Branches could not be checked until the repository is accessible."));
    return result;
  }
  result.checks.push(check("repository", "pass", "repository_exists", "Repository is accessible on GitHub."));
  if (repository.full_name?.toLowerCase() !== repoName(ref).toLowerCase()) {
    result.checks.push(check("repository address", "warning", "repository_renamed", "GitHub resolved a different canonical repository name. Review the configured address before delivering."));
  }
  if (!repository.default_branch) {
    result.checks.push(check("default branch", "fail", "default_branch_missing", "GitHub did not report a default branch. Check whether the repository is empty."));
    return result;
  }
  result.defaultBranch = repository.default_branch;
  result.deliveryBranch = input.branch || repository.default_branch;
  const defaultCheck = await branchCheck(client, ref, repository.default_branch, "default branch");
  result.checks.push(defaultCheck);
  result.checks.push(input.branch && input.branch !== repository.default_branch
    ? await branchCheck(client, ref, input.branch, "delivery branch")
    : { ...defaultCheck, key: "delivery branch", message: `${defaultCheck.message} No separate delivery branch is configured.` });
  return result;
}

/** Same configured-repository membership used by delivery gates, before any remote request. */
export function matchDeliveryRepository(project: ReadinessProjectInput, value: string): DeliveryReadiness {
  const ref = deliveryRef(value);
  if (!ref) return { url: null, check: check("delivery repository", "fail", "invalid_pull_request", "Enter a GitHub pull request URL, such as the link copied from its Code page.") };
  const url = `${repoUrl(ref)}/pull/${ref.number}`;
  const allowed = [project.repoUrl, ...project.repositories.map((item) => item.url)]
    .map(configuredRepo).filter((known): known is RepoRef => known !== null);
  if (!allowed.some((known) => sameRepo(known, ref))) {
    return { url, check: check("delivery repository", "fail", "wrong_repository", `This PR is in ${repoName(ref)}; ${project.name} accepts ${allowed.map(repoName).join(", ") || "no configured repository"}. Delivery would fail with 422 wrong_repository. Correct the project repositories or the PR link.`) };
  }
  return { url, check: check("delivery repository", "pass", "repository_matches", "The PR URL matches a configured project repository.") };
}

export async function inspectProjectReadiness(project: ReadinessProjectInput): Promise<ReadinessProject> {
  const inputs: { url: string | null; label: string; branch: string | null; installationId: string | null; main: boolean }[] = [
    ...(project.repoUrl ? [{ url: project.repoUrl, label: "Main repository", branch: null, installationId: project.githubInstallationId, main: true }] : []),
    ...project.repositories.map((item) => ({ url: item.url, label: item.label || "Additional repository", branch: item.branch, installationId: item.githubInstallationId || project.githubInstallationId, main: false })),
  ];
  if (!inputs.length) inputs.push({ url: null, label: "Main repository", branch: null, installationId: project.githubInstallationId, main: true });
  const repositories: ReadinessRepository[] = [];
  // Repositories are sequential inside a project; the query batches projects.
  for (const input of inputs) repositories.push(await inspectRepository(project, input));
  return {
    id: project.id, name: project.name, slug: project.slug, repositories,
    deliveries: project.bugs.filter((bug) => bug.pullRequestUrl).map((bug) => ({ ...matchDeliveryRepository(project, bug.pullRequestUrl!), issueNumber: bug.number })),
  };
}

/** Verify the actual PR base as well as its URL; never use a fork's head repo as the delivery target. */
export async function inspectDeliveryReadiness(project: ReadinessProjectInput, value: string): Promise<DeliveryReadiness> {
  const matched = matchDeliveryRepository(project, value);
  if (matched.check.state !== "pass") return matched;
  const ref = deliveryRef(value)!;
  try {
    const client = await githubClientFor({ githubInstallationId: installationIdForPullRequest(project, value) });
    const pr = await client.getOrNull<PullRequest>(`${repoPath(ref)}/pulls/${ref.number}`);
    if (!pr) return { ...matched, check: check("delivery", "fail", "pull_request_unavailable", "The pull request was not found or this installation cannot access it.") };
    const actual = configuredRepo(pr.base?.repo?.full_name ? `https://github.com/${pr.base.repo.full_name}` : null);
    if (!actual || !sameRepo(actual, ref)) return { ...matched, check: check("delivery", "fail", "wrong_repository", "GitHub reports a different PR base repository. Review the project configuration and use its current PR URL.") };
    const configured = project.repositories.find((item) => {
      const known = configuredRepo(item.url);
      return known && sameRepo(known, ref);
    });
    const branch = pr.base.ref;
    if (!branch) return { ...matched, check: check("delivery", "fail", "base_branch_missing", "GitHub did not report the PR's delivery branch.") };
    if (configured?.branch && configured.branch !== branch) return { ...matched, check: check("delivery", "fail", "wrong_branch", `The PR targets ${branch}; this repository's configured delivery branch is ${configured.branch}. Review the target in project settings.`) };
    const branchResult = await branchCheck(client, actual, branch, "delivery branch");
    if (branchResult.state !== "pass") return { ...matched, check: branchResult };
    return { ...matched, check: client.auth === "app"
      ? check("delivery", "pass", "delivery_ready", `Repository matches, delivery branch ${branch} exists, and the selected App installation can read the PR.`)
      : check("delivery", "warning", "app_access_unverified", `Repository matches and delivery branch ${branch} exists, but the read did not verify GitHub App installation access.`) };
  } catch (error) { return { ...matched, check: failure("delivery", error) }; }
}
