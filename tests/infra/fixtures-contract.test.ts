import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STATUS_OF } from "@/lib/issue-substatus";

/**
 * The checked-in local fixtures (scripts/dev/fixtures/local-ziki.json) load
 * into every test database. They must cover every step an issue can be at,
 * point only at rows they contain, and hold no real people.
 */
type Row = Record<string, unknown>;
const fx = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "dev", "fixtures", "local-ziki.json"), "utf8")) as Record<string, Row[]> & { login: { email: string } };
const ids = (name: string) => new Set(fx[name].map((row) => String(row.id)));

describe("the local fixtures", () => {
  it("have at least 200 issues, at every substatus, each under its main status", () => {
    expect(fx.bugs.length).toBeGreaterThanOrEqual(200);
    const seen = new Set(fx.bugs.map((bug) => String(bug.substatus)));
    for (const substatus of Object.keys(STATUS_OF)) expect(seen.has(substatus), substatus).toBe(true);
    for (const bug of fx.bugs) expect(bug.status, String(bug.number)).toBe(STATUS_OF[bug.substatus as keyof typeof STATUS_OF]);
  });

  it("number issues and ideas 1 to N, each issue from a converted idea", () => {
    const numbers = (rows: Row[]) => rows.map((row) => Number(row.number)).sort((a, b) => a - b);
    expect(numbers(fx.bugs)).toEqual(fx.bugs.map((_, i) => i + 1));
    expect(numbers(fx.ideas)).toEqual(fx.ideas.map((_, i) => i + 1));
    const converted = new Set(fx.ideas.filter((idea) => idea.status === "converted").map((idea) => idea.issueId));
    for (const bug of fx.bugs) expect(converted.has(bug.id), String(bug.number)).toBe(true);
  });

  it("point only at rows they contain", () => {
    const users = ids("users");
    const agents = ids("agents");
    const bugs = ids("bugs");
    const bids = ids("bids");
    const claims = ids("claims");
    const check = (table: string, field: string, set: Set<string>) => {
      for (const row of fx[table]) if (row[field] != null) expect(set.has(String(row[field])), `${table}.${field} ${row[field]}`).toBe(true);
    };
    for (const table of ["confirmations", "bids", "claims", "deliveries", "testVerdicts", "mergeReviews", "pullRequestReports", "comments", "votes", "activities", "bidVotes"]) check(table, "bugId", bugs);
    for (const table of ["confirmations", "bids", "claims", "deliveries", "testVerdicts", "mergeReviews", "pullRequestReports", "comments", "votes", "bidVotes", "ideaVerdicts"]) check(table, "agentId", agents);
    check("bids", "claimId", claims);
    check("bidVotes", "bidId", bids);
    check("bugs", "duplicateOfId", bugs);
    check("bugs", "linkedIssueId", bugs);
    check("bugs", "typeId", ids("issueTypes"));
    check("ideas", "typeId", ids("issueTypes"));
    check("bugs", "assigneeId", users);
    check("comments", "parentId", ids("comments"));
  });

  describe("marketing work", () => {
    const marketing = fx.bugs.filter((bug) => bug.track === "marketing");
    const marketingIds = new Set(marketing.map((bug) => bug.id));
    const on = (table: string) => fx[table].filter((row) => marketingIds.has(row.bugId));

    it("is at every marketing step, and never at a step marketing skips", () => {
      const seen = new Set(marketing.map((bug) => String(bug.substatus)));
      expect([...seen].sort()).toEqual(["accepted", "closed", "in_progress", "open", "published", "requires_review"]);
    });

    it("has ideas waiting, ready to convert, bad, rejected, archived and converted, each saying why", () => {
      const ideas = fx.ideas.filter((idea) => idea.track === "marketing");
      expect(new Set(ideas.map((idea) => idea.status))).toEqual(new Set(["open", "rejected", "archived", "converted"]));
      for (const idea of ideas) expect(String(idea.rationale ?? ""), String(idea.number)).not.toBe("");
      const open = ideas.filter((idea) => idea.status === "open");
      expect(open.some((idea) => Number(idea.score) >= 3)).toBe(true);
      expect(open.some((idea) => Number(idea.score) < 0)).toBe(true);
      for (const idea of fx.ideas.filter((row) => row.track !== "marketing")) expect(idea.rationale).toBeUndefined();
    });

    it("has no confirmation, pull request or deployment, and delivers links instead", () => {
      expect(on("confirmations")).toEqual([]);
      expect(on("pullRequestReports")).toEqual([]);
      for (const bug of marketing) expect(bug.pullRequestUrl).toBeUndefined();
      expect(on("deliveries").length).toBeGreaterThan(0);
      for (const delivery of on("deliveries")) {
        expect(delivery.pullRequestUrl).toBeNull();
        expect((delivery.deliverableUrls as string[]).length > 0 || Boolean(delivery.deliverableText)).toBe(true);
      }
    });

    it("stays within the default revision limit, with a fresh count once reopened", () => {
      for (const bug of marketing) expect(Number(bug.revisionCount)).toBeLessThanOrEqual(2);
      expect(marketing.some((bug) => Number(bug.revisionCount) === 2)).toBe(true);
      const reopened = on("claims").filter((claim) => claim.releaseReason === "revision_limit");
      expect(reopened.length).toBeGreaterThan(0);
      for (const claim of reopened) expect(marketing.find((bug) => bug.id === claim.bugId)).toMatchObject({ substatus: "open", revisionCount: 0 });
    });

    it("counts only judgements since the latest delivery towards work in review", () => {
      const counted = (bugId: unknown) => {
        const delivery = on("deliveries").find((row) => row.bugId === bugId)!;
        return on("testVerdicts").filter((row) => row.bugId === bugId && row.goodToMerge && Number(row.updatedAt) <= Number(delivery.updatedAt)).length;
      };
      for (const bug of marketing.filter((row) => row.substatus === "requires_review")) expect(counted(bug.id)).toBeLessThan(3);
      for (const bug of marketing.filter((row) => row.substatus === "accepted" || row.substatus === "published")) expect(counted(bug.id)).toBeGreaterThanOrEqual(3);
    });

    it("links only to product issues, and uses only marketing task types", () => {
      const linked = marketing.filter((bug) => bug.linkedIssueId);
      expect(linked.length).toBeGreaterThan(0);
      for (const bug of linked) expect(marketingIds.has(bug.linkedIssueId)).toBe(false);
      for (const type of fx.issueTypes) expect(type.track).toBe("marketing");
      for (const row of [...fx.bugs, ...fx.ideas]) expect(row.typeId != null).toBe(row.track === "marketing");
    });
  });

  it("hold no real people: every account is a made-up @fixtures.local one", () => {
    for (const user of fx.users) expect(String(user.email)).toMatch(/@fixtures\.local$/);
    expect(fx.login.email).toMatch(/@fixtures\.local$/);
  });
});
