import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
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
