import { describe, expect, it } from "vitest";
import { linkStateFromUrl } from "@/lib/agent-api/pr-gate";
import {
  installationIdForPullRequest,
  projectRepoRefs,
  repoForPullRequest,
} from "@/lib/github/project-repositories";

const project = {
  repoUrl: "https://github.com/acme/web",
  githubInstallationId: "111",
  repositories: [
    { url: "https://github.com/acme/api", githubInstallationId: null },
    { url: "https://github.com/partner/mobile", githubInstallationId: "222" },
  ],
};

describe("projectRepoRefs", () => {
  it("lists the main repository first, then the others", () => {
    expect(projectRepoRefs(project)).toEqual([
      { owner: "acme", repo: "web" },
      { owner: "acme", repo: "api" },
      { owner: "partner", repo: "mobile" },
    ]);
  });

  it("lists a repository once, however it is spelled", () => {
    const refs = projectRepoRefs({
      repoUrl: "https://github.com/Acme/Web",
      repositories: [{ url: "https://github.com/acme/web" }],
    });
    expect(refs).toHaveLength(1);
  });

  it("is empty for a project that names nothing", () => {
    expect(projectRepoRefs({ repoUrl: null })).toEqual([]);
    expect(projectRepoRefs(null)).toEqual([]);
  });
});

describe("repoForPullRequest", () => {
  it("picks the listed repository a pull request is in", () => {
    expect(repoForPullRequest(project, "https://github.com/acme/api/pull/7")).toEqual({ owner: "acme", repo: "api" });
    expect(repoForPullRequest(project, "https://github.com/Partner/Mobile/pull/9")).toEqual({
      owner: "partner",
      repo: "mobile",
    });
  });

  it("falls back to the main repository when the pull request is in none of them", () => {
    expect(repoForPullRequest(project, "https://github.com/someone/else/pull/1")).toEqual({ owner: "acme", repo: "web" });
    expect(repoForPullRequest(project, "not a url")).toEqual({ owner: "acme", repo: "web" });
    expect(repoForPullRequest(project, null)).toEqual({ owner: "acme", repo: "web" });
  });

  it("uses the first listed repository when the project has no main one", () => {
    const only = { repoUrl: null, repositories: [{ url: "https://github.com/acme/api" }] };
    expect(repoForPullRequest(only, "https://github.com/acme/api/pull/3")).toEqual({ owner: "acme", repo: "api" });
    expect(repoForPullRequest(only, "https://github.com/acme/other/pull/3")).toEqual({ owner: "acme", repo: "api" });
    expect(repoForPullRequest({ repoUrl: null }, "https://github.com/acme/api/pull/3")).toBeNull();
  });

  it("keeps the gate's answers: ok in a listed repository, other_repository elsewhere", () => {
    const inApi = "https://github.com/acme/api/pull/7";
    const elsewhere = "https://github.com/someone/else/pull/1";
    expect(linkStateFromUrl(inApi, repoForPullRequest(project, inApi))).toBe("ok");
    expect(linkStateFromUrl(elsewhere, repoForPullRequest(project, elsewhere))).toBe("other_repository");
    expect(linkStateFromUrl(null, repoForPullRequest(project, null))).toBe("missing");
  });

  it("without listed repositories behaves exactly as a single-repository project", () => {
    const single = { repoUrl: "https://github.com/acme/web" };
    const inWeb = "https://github.com/acme/web/pull/1";
    const inApi = "https://github.com/acme/api/pull/1";
    expect(linkStateFromUrl(inWeb, repoForPullRequest(single, inWeb))).toBe("ok");
    expect(linkStateFromUrl(inApi, repoForPullRequest(single, inApi))).toBe("other_repository");
    expect(linkStateFromUrl(inWeb, repoForPullRequest({ repoUrl: null }, inWeb))).toBe("unknown");
  });
});

describe("installationIdForPullRequest", () => {
  it("uses the project's installation for the main repository and ones without their own", () => {
    expect(installationIdForPullRequest(project, "https://github.com/acme/web/pull/1")).toBe("111");
    expect(installationIdForPullRequest(project, "https://github.com/acme/api/pull/2")).toBe("111");
  });

  it("uses a listed repository's own installation", () => {
    expect(installationIdForPullRequest(project, "https://github.com/partner/mobile/pull/3")).toBe("222");
  });

  it("falls back to the project's installation when nothing matches", () => {
    expect(installationIdForPullRequest(project, "https://github.com/someone/else/pull/4")).toBe("111");
    expect(installationIdForPullRequest({ repoUrl: null }, null)).toBeNull();
  });
});
