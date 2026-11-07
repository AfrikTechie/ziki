import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubError, type GitHubClient } from "@/lib/github/client";
import { inspectDeliveryReadiness, inspectProjectReadiness, matchDeliveryRepository, type ReadinessProjectInput } from "@/lib/github/repository-readiness";

const readinessClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github/client", async (original) => ({ ...await original<typeof import("@/lib/github/client")>(), githubClientFor: readinessClient }));
import { diagnose } from "@/lib/github/merge-blockers";
import { githubStatusPowers } from "@/lib/github/status-access";
import { signatureMatches } from "@/lib/github/webhook-signature";
import type { PullRequestSnapshot, SnapshotCheck } from "@/lib/github/snapshot-types";

/** Ziki reads pull requests on GitHub itself (#github-status): what blocks a merge, who may act on it, and which webhooks count. */

const check = (name: string, status: SnapshotCheck["status"], actionsRunId: number | null = 7): SnapshotCheck =>
  ({ name, kind: "check", status, conclusion: status === "failing" ? "failure" : "success", url: `https://github.com/o/r/actions/runs/${actionsRunId}/job/1`, summary: null, actionsRunId });

const pr = (over: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot => ({
  fetchedAt: "2026-11-05T12:00:00.000Z", url: "https://github.com/o/r/pull/9", number: 9, title: "Fix", author: "dev",
  state: "open", draft: false, mergeable: true, mergeableState: "clean", headSha: "a".repeat(40), headRef: "fix", headRepo: "o/r",
  baseRef: "main", defaultBranch: "main", behindBy: 0, aheadBy: 1, maintainerCanModify: true, mergedAt: null, mergedBy: null,
  mergeCommitSha: null, inDefaultBranch: null, checks: [check("build", "passing")], checksSummary: "passing", reviews: [], requestedReviewers: [],
  ...over,
});

describe("diagnose (#github-status)", () => {
  it("lets a clean pull request with passing checks merge", () => {
    const result = diagnose(pr());
    expect(result).toMatchObject({ verdict: "ready", canMerge: true, sendBackNote: null });
  });

  it("blocks conflicts, failing checks and requested changes, and drafts the fixer's note from them", () => {
    const result = diagnose(pr({
      mergeable: false, mergeableState: "dirty", checks: [check("build", "failing")],
      reviews: [{ login: "amy", state: "CHANGES_REQUESTED", url: "https://github.com/o/r/pull/9#r1", submittedAt: null, body: "Handle the error." }],
    }));
    expect(result.verdict).toBe("blocked");
    expect(result.canMerge).toBe(false);
    expect(result.blockers.map((b) => b.kind)).toEqual(["conflicts", "check_failing", "changes_requested"]);
    expect(result.blockers.every((b) => b.who === "fixer")).toBe(true);
    expect(result.sendBackNote).toContain("Merge conflicts with main");
    expect(result.sendBackNote).toContain("Handle the error.");
  });

  it("offers a re-run only for GitHub Actions checks", () => {
    expect(diagnose(pr({ checks: [check("build", "failing", 7)] })).blockers[0].actions).toEqual(["rerun_checks", "send_back"]);
    expect(diagnose(pr({ checks: [check("ci", "failing", null)] })).blockers[0].actions).toEqual(["send_back"]);
  });

  it("blocks a branch that must be up to date and offers Update branch, unless a fork locks its branch", () => {
    const behind = diagnose(pr({ behindBy: 3, mergeableState: "behind" }));
    expect(behind.verdict).toBe("blocked");
    expect(behind.blockers[0]).toMatchObject({ kind: "behind", who: "merger", actions: ["update_branch"] });
    expect(diagnose(pr({ behindBy: 3, mergeableState: "clean" })).verdict).toBe("ready");
    expect(diagnose(pr({ behindBy: 3, mergeableState: "behind", maintainerCanModify: false })).blockers[0].actions).toEqual(["send_back"]);
  });

  it("waits on running checks and on GitHub's unknown mergeability, without merging", () => {
    expect(diagnose(pr({ checks: [check("build", "pending")] }))).toMatchObject({ verdict: "waiting", canMerge: false });
    expect(diagnose(pr({ mergeable: null, mergeableState: "unknown" }))).toMatchObject({ verdict: "waiting", canMerge: false });
  });

  it("explains branch protection: a requested reviewer, else the rule itself", () => {
    expect(diagnose(pr({ mergeableState: "blocked", requestedReviewers: ["amy"] })).blockers[0]).toMatchObject({ kind: "review_required", who: "reviewer" });
    expect(diagnose(pr({ mergeableState: "blocked" })).blockers[0]).toMatchObject({ kind: "protected", who: "merger" });
  });

  it("sends a closed or missing pull request back to the fixer, and never merges it", () => {
    expect(diagnose(pr({ state: "closed" }))).toMatchObject({ verdict: "closed", canMerge: false });
    expect(diagnose(pr({ state: "not_found" })).blockers[0].actions).toEqual(["send_back"]);
  });

  it("warns, without blocking, about commits pushed since the fix was accepted", () => {
    const result = diagnose(pr(), { reviewedHeadSha: "b".repeat(40), reviewedAs: "accepted" });
    expect(result.verdict).toBe("ready");
    expect(result.blockers[0]).toMatchObject({ kind: "head_moved", level: "warning" });
  });
});

describe("githubStatusPowers (#github-status)", () => {
  const base = { member: true, admin: false, ownsIssue: false, agentLevels: [] as ("working" | "manager" | "merger")[] };
  it("lets any member read, but only admins, the issue's owner and manager or merger owners act", () => {
    expect(githubStatusPowers(base)).toEqual({ refresh: true, act: false, merge: false });
    expect(githubStatusPowers({ ...base, ownsIssue: true })).toEqual({ refresh: true, act: true, merge: false });
    expect(githubStatusPowers({ ...base, agentLevels: ["manager"] })).toEqual({ refresh: true, act: true, merge: false });
  });
  it("keeps merging for admins and merger agents' owners", () => {
    expect(githubStatusPowers({ ...base, agentLevels: ["merger"] }).merge).toBe(true);
    expect(githubStatusPowers({ ...base, admin: true }).merge).toBe(true);
  });
  it("gives a non-member nothing", () => {
    expect(githubStatusPowers({ ...base, member: false, agentLevels: ["merger"] })).toEqual({ refresh: false, act: false, merge: false });
  });
});

describe("GitHub webhook signatures (#github-status)", () => {
  it("accepts only a body signed with the secret", () => {
    const body = '{"action":"opened"}';
    const good = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect(signatureMatches(body, good, "s3cret")).toBe(true);
    expect(signatureMatches(body, good, "other")).toBe(false);
    expect(signatureMatches(`${body} `, good, "s3cret")).toBe(false);
    expect(signatureMatches(body, null, "s3cret")).toBe(false);
  });
});

describe("repository readiness before delivery", () => {
  const project = (over: Partial<ReadinessProjectInput> = {}): ReadinessProjectInput => ({
    id: "p1", name: "Mobile", slug: "mobile", repoUrl: "https://github.com/acme/mobile",
    githubInstallationId: "17", repositories: [], bugs: [], ...over,
  });
  const get = vi.fn();
  const client = (auth: GitHubClient["auth"] = "app"): GitHubClient => ({ auth, canWrite: auth !== "none", get, getOrNull: get, send: vi.fn() });
  const checks = async (over: Partial<ReadinessProjectInput> = {}) => (await inspectProjectReadiness(project(over))).repositories[0].checks;
  beforeEach(() => {
    vi.clearAllMocks();
    readinessClient.mockResolvedValue(client());
    get.mockImplementation(async (path: string) => path.endsWith("/pulls/9")
      ? { base: { ref: "main", repo: { full_name: "acme/mobile" } }, head: { repo: { full_name: "fork/mobile" } } }
      : path.includes("/branches/") ? { name: "main" } : { full_name: "acme/mobile", default_branch: "main" });
  });

  it("requires app access and both branches before a repository is ready", async () => {
    const result = await checks();
    expect(result.every((item) => item.state === "pass")).toBe(true);
    expect(result.map((item) => item.key)).toEqual(["app installation", "repository", "default branch", "delivery branch"]);
    expect(get.mock.calls.filter(([path]) => path.includes("/branches/"))).toHaveLength(1);
  });

  it.each([null, "http://github.com/acme/mobile", "https://other.test/acme/mobile", "https://user:password@github.com/acme/mobile", "https://github.com/acme/mobile?secret=private", "git@github.com:../mobile"])("rejects unsafe or missing repository configuration without a request: %s", async (repoUrl) => {
    const result = await inspectProjectReadiness(project({ repoUrl }));
    expect(result.repositories[0]).toMatchObject({ url: null, checks: [expect.objectContaining({ code: "invalid_repository", state: "fail" })] });
    expect(readinessClient).not.toHaveBeenCalled();
    expect(matchDeliveryRepository(project({ repoUrl }), "https://github.com/acme/mobile/pull/9").check.code).toBe("wrong_repository");
  });

  it("does not claim that a 404 proves a private repository is absent", async () => {
    get.mockResolvedValue(null);
    const result = await checks();
    expect(result).toContainEqual(expect.objectContaining({ key: "repository", code: "not_found_or_inaccessible", state: "fail" }));
    expect(result).toContainEqual(expect.objectContaining({ code: "not_checked" }));
    expect(get.mock.calls.some(([path]) => path.includes("/branches/"))).toBe(false);
  });

  it("keeps app access failed even when a public read finds the repository", async () => {
    get.mockResolvedValueOnce(null);
    readinessClient.mockResolvedValueOnce(client()).mockResolvedValueOnce(client("none"));
    const result = await checks();
    expect(result).toContainEqual(expect.objectContaining({ key: "app installation", state: "fail" }));
    expect(result).toContainEqual(expect.objectContaining({ code: "repository_exists", state: "pass" }));
  });

  it.each(["token", "none"] as const)("does not treat %s fallback as verified App access", async (auth) => {
    readinessClient.mockResolvedValue(client(auth));
    expect(await checks()).toContainEqual(expect.objectContaining({ key: "app installation", state: "warning", code: "app_auth_unavailable" }));
    expect(await checks({ githubInstallationId: null })).toContainEqual(expect.objectContaining({ code: "installation_missing" }));
  });

  it.each([[401, "authentication_failed"], [403, "access_or_rate_limit"], [429, "access_or_rate_limit"], [500, "github_unavailable"]])("reports GitHub %s without leaking its response", async (status, code) => {
    get.mockRejectedValue(new GitHubError(Number(status), "private-token-response"));
    const result = await checks();
    expect(result).toContainEqual(expect.objectContaining({ key: "repository", code, state: "fail" }));
    expect(JSON.stringify(result)).not.toContain("private-token-response");
  });

  it("reports transport failures safely", async () => {
    get.mockRejectedValue(new Error("private-transport-details"));
    expect(await inspectDeliveryReadiness(project(), "https://github.com/acme/mobile/pull/9")).toMatchObject({ check: { code: "github_unavailable", state: "fail" } });
  });

  it("flags an empty repository without a default branch", async () => {
    get.mockResolvedValue({ full_name: "acme/mobile", default_branch: "" });
    expect(await checks()).toContainEqual(expect.objectContaining({ code: "default_branch_missing", state: "fail" }));
  });

  it("reports a missing default branch", async () => {
    get.mockResolvedValueOnce({ full_name: "acme/mobile", default_branch: "main" }).mockResolvedValue(null);
    expect(await checks()).toContainEqual(expect.objectContaining({ key: "default branch", code: "branch_missing", state: "fail" }));
  });

  it("does not accept a response for a different branch as evidence that the configured branch exists", async () => {
    get.mockResolvedValueOnce({ full_name: "acme/mobile", default_branch: "staging" }).mockResolvedValue({ name: "main" });
    expect(await checks()).toContainEqual(expect.objectContaining({ key: "default branch", code: "branch_missing", state: "fail" }));
  });

  it("checks an additional repository's own installation and encoded delivery branch", async () => {
    get.mockImplementation(async (path: string) => path.endsWith("/branches/release%2Fmobile") ? null
      : path.includes("/branches/") ? { name: "main" } : { full_name: "acme/mobile", default_branch: "main" });
    const result = await inspectProjectReadiness(project({ repoUrl: null, repositories: [{ url: "https://github.com/acme/mobile", label: "App", branch: "release/mobile", githubInstallationId: "22" }] }));
    expect(readinessClient).toHaveBeenCalledWith({ githubInstallationId: "22" });
    expect(result.repositories[0].checks).toContainEqual(expect.objectContaining({ key: "delivery branch", code: "branch_missing" }));
  });

  it("flags Mobile pointing at Desktop and mismatching linked deliveries", async () => {
    const result = await inspectProjectReadiness(project({ repoUrl: "https://github.com/acme/desktop", bugs: [{ number: 7, pullRequestUrl: "https://github.com/acme/mobile/pull/9" }] }));
    expect(result.repositories[0].checks).toContainEqual(expect.objectContaining({ code: "possible_project_mismatch", state: "warning" }));
    expect(result.deliveries[0]).toMatchObject({ issueNumber: 7, check: { code: "wrong_repository", state: "fail" } });
  });

  it("warns when GitHub redirects an outdated repository address", async () => {
    get.mockResolvedValueOnce({ full_name: "acme/renamed", default_branch: "main" });
    expect(await checks()).toContainEqual(expect.objectContaining({ code: "repository_renamed", state: "warning" }));
  });

  it("rejects wrong-repository and invalid PR links before contacting GitHub", async () => {
    const result = await inspectDeliveryReadiness(project(), "https://github.com/acme/desktop/pull/9");
    expect(result.check).toMatchObject({ code: "wrong_repository", state: "fail" });
    expect(result.check.message).toContain("422 wrong_repository");
    expect(matchDeliveryRepository(project(), "https://private:password@github.com/acme/mobile/pull/9")).toMatchObject({ url: null, check: { code: "invalid_pull_request" } });
    expect(readinessClient).not.toHaveBeenCalled();
  });

  it("accepts case-insensitive configured repositories and verifies the base, not a fork head", async () => {
    const result = await inspectDeliveryReadiness(project({ repoUrl: "https://github.com/ACME/Mobile" }), "https://github.com/acme/mobile/pull/9");
    expect(result.check).toMatchObject({ code: "delivery_ready", state: "pass" });
  });

  it.each([
    [null, "pull_request_unavailable"],
    [{ base: { ref: "main", repo: { full_name: "acme/desktop" } } }, "wrong_repository"],
    [{ base: { ref: "", repo: { full_name: "acme/mobile" } } }, "base_branch_missing"],
  ])("blocks unavailable or inconsistent actual PR bases", async (response, code) => {
    get.mockResolvedValue(response);
    expect(await inspectDeliveryReadiness(project(), "https://github.com/acme/mobile/pull/9")).toMatchObject({ check: { code, state: "fail" } });
  });

  it("rejects a PR targeting a different configured delivery branch", async () => {
    const result = await inspectDeliveryReadiness(project({ repositories: [{ url: "https://github.com/acme/mobile", label: null, branch: "staging", githubInstallationId: "22" }] }), "https://github.com/acme/mobile/pull/9");
    expect(result.check).toMatchObject({ code: "wrong_branch", state: "fail" });
    expect(readinessClient).toHaveBeenCalledWith({ githubInstallationId: "22" });
  });

  it("blocks a PR whose actual delivery branch cannot be read", async () => {
    get.mockResolvedValueOnce({ base: { ref: "main", repo: { full_name: "acme/mobile" } } }).mockResolvedValue(null);
    expect(await inspectDeliveryReadiness(project(), "https://github.com/acme/mobile/pull/9")).toMatchObject({ check: { code: "branch_missing", state: "fail" } });
  });

  it("never marks a delivery ready based only on a fallback token", async () => {
    readinessClient.mockResolvedValue(client("token"));
    expect(await inspectDeliveryReadiness(project(), "https://github.com/acme/mobile/pull/9")).toMatchObject({ check: { code: "app_access_unverified", state: "warning" } });
  });
});
