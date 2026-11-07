import { parseGitHubRepoUrl, parsePullRequestUrl, sameRepo, type RepoRef } from "@/lib/github/pull-request-url";

/**
 * A project's repositories (#2). `Project.repoUrl` is the main one; a project
 * can list more (its API next to its web app, a mobile app, ...). A pull
 * request in any of them can be linked, delivered, accepted and resolved: every
 * gate keeps its one rule ("is this pull request in the project's
 * repository?") and asks this module which repository that is for the pull
 * request in question.
 */

/** What a project row carries to answer that. Spread `PROJECT_REPOSITORIES_SELECT` into a project `select`. */
export type ProjectRepositories = {
  repoUrl: string | null;
  githubInstallationId?: string | null;
  repositories?: { url: string; githubInstallationId?: string | null }[] | null;
};

/** Prisma `select` fragment for the listed repositories, beside `repoUrl` and `githubInstallationId`. */
export const PROJECT_REPOSITORIES_SELECT = {
  repositories: { select: { url: true, githubInstallationId: true } },
} as const;

/** Every repository a fix can be in, the main one first. */
export function projectRepoRefs(project: ProjectRepositories | null | undefined): RepoRef[] {
  if (!project) return [];
  const refs: RepoRef[] = [];
  const main = parseGitHubRepoUrl(project.repoUrl);
  if (main) refs.push(main);
  for (const listed of project.repositories ?? []) {
    const ref = parseGitHubRepoUrl(listed.url);
    if (ref && !refs.some((known) => sameRepo(known, ref))) refs.push(ref);
  }
  return refs;
}

/**
 * The project's repository that `pullRequestUrl` is in: a listed one when it
 * matches, otherwise the main one (or the first listed, for a project with no
 * main one). So a pull request in an unlisted repository
 * still fails the existing checks (`other_repository`, `wrong_repository`), a
 * pull request under a former name of the main repository still reads as
 * `old_repository`, and a project that names no repository is still `unknown`.
 * Pass no URL (nothing linked yet) and you get the main repository.
 */
export function repoForPullRequest(
  project: ProjectRepositories | null | undefined,
  pullRequestUrl: string | null | undefined,
): RepoRef | null {
  const refs = projectRepoRefs(project);
  const home = refs[0] ?? null;
  const ref = parsePullRequestUrl(pullRequestUrl);
  if (!ref) return home;
  return refs.find((repo) => sameRepo(repo, ref)) ?? home;
}

/**
 * The GitHub App installation to read `pullRequestUrl` with: the installation
 * of the listed repository it is in when that has its own (a repository in
 * another organization), otherwise the project's.
 */
export function installationIdForPullRequest(
  project: ProjectRepositories | null | undefined,
  pullRequestUrl: string | null | undefined,
): string | null {
  const fallback = project?.githubInstallationId ?? null;
  const ref = parsePullRequestUrl(pullRequestUrl);
  if (!ref) return fallback;
  const listed = (project?.repositories ?? []).find((repository) => {
    const repo = parseGitHubRepoUrl(repository.url);
    return repo ? sameRepo(repo, ref) : false;
  });
  return listed?.githubInstallationId ?? fallback;
}
