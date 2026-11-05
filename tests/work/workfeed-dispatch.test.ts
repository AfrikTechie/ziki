import { describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { itemsFor, workEtag, type AgentWork, type ProjectWork, type WorkFeed } from "@/lib/agent-api/work";
import { prGate } from "@/lib/agent-api/pr-gate";
import type { StoredPullRequestReport } from "@/lib/agent-api/pull-request-report";

/** The work feed (#work-feed, #owner-agents): each agent sees the work it can act on, manager and merger work is shown but not actionable below those classes, and the feed's ETag follows its content. */
const REPO = { owner: "emerjent", repo: "ziki" };
const PR = "https://github.com/emerjent/ziki/pull/552";
const REPORTED_AT = new Date("2026-10-31T11:00:00Z");

/** Erin's agent's report on a pull request: open, checks passing, can merge, at head-sha. */
const prReport = (overrides: Partial<StoredPullRequestReport> = {}): StoredPullRequestReport => ({
  id: "rep1",
  bugId: "b2",
  pullRequestUrl: PR,
  state: "open",
  mergedInto: null,
  inDefaultBranch: null,
  headSha: "head-sha",
  mergeCommitSha: null,
  checks: "passing",
  mergeable: true,
  note: "Checked on GitHub.",
  agentId: "agent-owner-erin",
  onBehalfOfUserId: "owner-erin",
  createdAt: REPORTED_AT,
  agent: { name: "Erin's agent" },
  onBehalfOf: { name: "Erin" },
  ...overrides,
}) as StoredPullRequestReport;

/** An issue In progress or later with its pull request and latest report, through the real gate (#pr-reports). */
const prIssue = (id: string, number: number, pullRequestUrl: string, status: string, report: StoredPullRequestReport | null = null) => ({
  id,
  number,
  title: "Fix",
  status,
  pullRequestUrl,
  report,
  gate: prGate(report, { pullRequestUrl, pullRequestHeadSha: "head-sha", repo: REPO }),
});

const agent = (level: AgentContext["level"], ownerId = "owner-bob"): AgentContext => ({
  agentId: `agent-${ownerId}`,
  name: "bob",
  ownerId,
  tenantId: "t1",
  level,
  burst: false,
  keyId: "k1",
  projectId: "p1",
});

const facts = (overrides: Partial<ProjectWork["facts"] extends Map<string, infer F> ? F : never> = {}) => ({
  reporterId: "owner-ada",
  beneficiaryUserId: "owner-ada",
  assigneeId: null,
  createdByAgentId: "agent-owner-ada",
  createdByAgent: { ownerUserId: "owner-ada" },
  pullRequestUrl: null,
  claims: [],
  confirmerOwners: [],
  deliveryAgentIds: [],
  testerOwners: [],
  ...overrides,
});

/** Who filed an idea and who already judged it (#idea-table): ideas are not issues. */

function work(overrides: Partial<ProjectWork> = {}): ProjectWork {
  return {
    tenantId: "t1",
    project: { id: "p1", slug: "ziki", name: "Ziki", orgSlug: "zedu" },
    importance: [],
    deployments: [],
    contests: [],
    rewards: [],
    ideas: [],
    toConvert: [],
    toReject: [],
    toReclaim: [],
    toSenseCheck: [],
    toReviewIdle: [],
    toClose: [],
    toDeliverStranded: [],
    toReconcile: [],
    toAwaitRelease: [],
    toRepair: [],
    toReportPr: [],
    prGates: new Map(),
    toConfirm: [],
    ideaThreshold: 3,
    tests: [],
    ready: [],
    bids: [],
    toAward: [],
    toInvestigate: [],
    comments: [],
    toAccept: [],
    toMerge: [],
    jobs: [],
    facts: new Map(),
    ideaFacts: new Map(),
    offerWindowSeconds: 1800,
    capacity: 2,
    governance: { thresholdOnly: false, managerVoteWeight: 3, closeThreshold: 3, awardThreshold: 3, acceptThreshold: 3 },
    ...overrides,
  };
}

const nothingMine: AgentWork = { offers: [], reviewOffers: [], jobReviewOffers: [], claims: [], unread: 0 };

/** One open bid on issue #1 (#bid-votes). */
const openBid = (overrides: Partial<ProjectWork["bids"][number]> = {}): ProjectWork["bids"][number] => ({
  id: "bid-ada",
  issue: { id: "b1", number: 1, title: "x" },
  agentName: "Ada's Claude",
  ownerIds: ["owner-ada"],
  by: "Ada",
  summary: "I will fix the redirect.",
  weightedVotes: 0,
  voters: [],
  load: 0,
  createdAt: new Date("2026-10-29T10:00:00Z"),
  ...overrides,
});

describe("itemsFor", () => {

  it("asks to confirm a converted issue at the confirmations route, and drops it once the owner gave an entry", () => {
    const issue = { id: "b1", number: 7, title: "x", confirmations: 1, needed: 2, confirmed: false };
    const items = itemsFor(agent("working"), work({ toConfirm: [issue], facts: new Map([["b1", facts()]]) }), nothingMine);
    expect(items[0]).toMatchObject({ kind: "confirm_issue", canAct: true });
    expect(items[0].detail).toContain("1 of 2 confirmations");
    expect(items[0].actions.map((a) => a.name)).toEqual(["confirm_issue"]);
    expect(items[0].actions[0].path).toContain("/api/v1/issues/b1/confirmations");
    expect(items[0].actions[0].cli).toContain("confirm-issue --id b1 --verdict confirm|reject|neutral --summary");

    // A worker agent's owner gave a working-class entry: not asked again (a manager agent still may give one).
    const done = facts({ confirmerOwners: ["owner-bob:working"] });
    expect(itemsFor(agent("working"), work({ toConfirm: [issue], facts: new Map([["b1", done]]) }), nothingMine)).toEqual([]);
  });

  it("leaves out fixes the owner already judged at this pull request with this class, not the other class (#owner-agents)", () => {
    const pr = "https://github.com/emerjent/ziki/pull/1";
    const tested = facts({ pullRequestUrl: pr, testerOwners: [{ ownerUserId: "owner-bob", verdictClass: "working", pullRequestUrl: pr }] });
    const project = work({ tests: [{ id: "b1", number: 7, title: "x", pullRequestUrl: pr }], facts: new Map([["b1", tested]]) });
    expect(itemsFor(agent("working"), project, nothingMine)).toEqual([]);
    expect(itemsFor(agent("manager"), project, nothingMine).some((i) => i.kind === "test_fix")).toBe(true);
  });

  it("lists manager and merger work for a working agent without letting it act", () => {
    const project = work({
      ready: [{ id: "b1", number: 1, title: "x", importance: 3 }],
      toAward: [{ id: "b4", number: 4, title: "w", bids: [openBid({ issue: { id: "b4", number: 4, title: "w" }, weightedVotes: 3 })] }],
      toClose: [{ id: "b5", number: 5, title: "v", reason: "superseded", votes: 3, tallies: [{ reason: "superseded", votes: 3 }], threshold: 3, suggestions: 1, summaries: ["#2 covers it."], suggesters: ["owner-cara"], duplicateOfNumber: null }],
      toAccept: [{ id: "b2", number: 2, title: "y" }],
      toMerge: [{ id: "b3", number: 3, title: "z" }],
      facts: new Map([["b2", facts()], ["b3", facts()]]),
    });
    const items = itemsFor(agent("working"), project, nothingMine);
    const byKind = Object.fromEntries(items.map((item) => [item.kind, item]));
    expect(byKind.ready_issue).toMatchObject({ canAct: true, minimumRole: "working" });
    expect(byKind).not.toHaveProperty("dispatch");
    // A bid at the threshold is any agent's to award (#bid-votes).
    expect(byKind.award_bid).toMatchObject({ canAct: true, minimumRole: "working" });
    expect(byKind.close_issue).toMatchObject({ canAct: false, minimumRole: "manager", blockedReason: "Needs a manager agent." });
    expect(byKind.accept_fix).toMatchObject({ canAct: false, minimumRole: "manager" });
    expect(byKind.merge_fix).toMatchObject({ canAct: false, minimumRole: "merger", blockedReason: "Needs a merger agent." });

    const merger = Object.fromEntries(itemsFor(agent("merger"), project, nothingMine).map((item) => [item.kind, item]));
    expect(merger.award_bid.canAct).toBe(true);
    expect(merger.close_issue.canAct).toBe(true);
    expect(merger.accept_fix.canAct).toBe(true);
    expect(merger.merge_fix.canAct).toBe(true);
  });

  it("asks to stake or bid on a ready issue, with no offer request (#stakes)", () => {
    const [item] = itemsFor(agent("working"), work({ ready: [{ id: "b1", number: 1, title: "x", importance: 3 }] }), nothingMine);
    expect(item).toMatchObject({ kind: "ready_issue", title: "Bid on #1", canAct: true });
    expect(item.actions.map((a) => a.name)).toEqual(["stake", "bid"]);
    expect(item.actions[0]).toMatchObject({ method: "POST", path: "/api/v1/issues/b1/stake?projectId=p1" });
    expect(item.actions[1]).toMatchObject({ method: "POST", path: "/api/v1/issues/b1/bid?projectId=p1" });
  });

  it("asks agents to vote for an open bid, not a working agent of its own owner, nor a past voter (#bid-votes)", () => {
    const bid = openBid({ weightedVotes: 1, voters: ["owner-cara"] });
    const items = itemsFor(agent("working"), work({ bids: [bid] }), nothingMine).filter((item) => item.kind === "review_bid");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "review_bid:bid-ada", minimumRole: "working", canAct: true, issue: { id: "b1", number: 1 } });
    expect(items[0].detail).toContain("It has 1 vote");
    expect(items[0].detail).toContain("Any agent may award it now");
    expect(items[0].actions).toEqual([
      { name: "vote_bid", minimumRole: "working", method: "POST", path: "/api/v1/bids/bid-ada/votes?projectId=p1", cli: "vote-bid --id bid-ada" },
    ]);

    for (const ownerId of ["owner-ada", "owner-cara"]) {
      expect(itemsFor(agent("working", ownerId), work({ bids: [bid] }), nothingMine).some((item) => item.kind === "review_bid")).toBe(false);
    }
  });

  it("shows each bidder's load and offers no award for a bid at capacity (#bidder-capacity)", () => {
    const issue = { id: "b1", number: 1, title: "x" };
    const bids = [
      openBid({ id: "bid-pixel", agentName: "Pixel", ownerIds: ["owner-pix"], by: "Pix", weightedVotes: 5, load: 2 }),
      openBid({ id: "bid-cara", agentName: "Cara's Claude", ownerIds: ["owner-cara"], by: "Cara", weightedVotes: 3, load: 1 }),
    ];
    const item = itemsFor(agent("working", "owner-eli"), work({ toAward: [{ ...issue, bids }] }), nothingMine).find((i) => i.kind === "award_bid");
    expect(item).toMatchObject({ canAct: true, title: "Award #1: 2 bids waiting, nobody holds it" });
    expect(item!.detail).toContain("Pixel: 2 of 2 — at capacity");
    expect(item!.detail).toContain("Cara's Claude: 1 of 2");
    expect(item!.actions.map((a) => a.cli)).toEqual(["award-bid --id bid-cara"]);
  });

  it("lets a manager accept its own owner's fix (#owner-agents)", () => {
    const own = facts({ reporterId: "owner-dana", beneficiaryUserId: "owner-dana" });
    const items = itemsFor(agent("manager", "owner-dana"), work({ toAccept: [{ id: "b2", number: 2, title: "y" }], facts: new Map([["b2", own]]) }), nothingMine);
    expect(items[0]).toMatchObject({ kind: "accept_fix", canAct: true });
  });

  it("asks an independent agent to check a pull request on GitHub and report it, not the issue's own side (#pr-reports)", () => {
    const pr9 = "https://github.com/emerjent/ziki/pull/9";
    const unreported = prIssue("b3", 9, pr9, "delivered");
    const project = (report: StoredPullRequestReport | null, why: string) => work({
      toReportPr: [{ ...prIssue("b3", 9, pr9, "delivered", report), why }],
      prGates: new Map([["b3", unreported.gate]]),
      facts: new Map([["b3", facts({ pullRequestUrl: pr9, assigneeId: "owner-cara", deliveryAgentIds: ["agent-finn-worker"] })]]),
    });
    const fresh = project(null, "Nobody has reported this pull request's state yet.");
    const item = itemsFor(agent("working", "owner-eli"), fresh, nothingMine).find((i) => i.kind === "report_pr_status");
    expect(item).toMatchObject({
      key: `report_pr_status:b3:${pr9}:none`,
      title: "Check PR #9 on GitHub and report its state",
      minimumRole: "working",
      canAct: true,
      issue: { id: "b3", number: 9 },
    });
    expect(item!.detail).toContain(`#9 links ${pr9}. Nobody has reported this pull request's state yet.`);
    expect(item!.actions).toEqual([expect.objectContaining({ name: "report_pr_status", minimumRole: "working", method: "POST", path: "/api/v1/issues/b3/pull-request-status?projectId=p1" })]);
    expect(item!.actions[0].cli).toContain(`report-pr-status --id b3 --pull-request-url ${pr9}`);

    // The filer's, the assignee's and the deliverer's other agents may report too (#owner-agents).
    for (const ownerId of ["owner-ada", "owner-cara", "owner-finn"]) {
      expect(itemsFor(agent("manager", ownerId), fresh, nothingMine).some((i) => i.kind === "report_pr_status")).toBe(true);
    }
    // Only the agent that delivered it is not asked.
    const deliverer = { ...agent("working", "owner-finn"), agentId: "agent-finn-worker" };
    expect(itemsFor(deliverer, fresh, nothingMine).some((i) => i.kind === "report_pr_status")).toBe(false);

    // An old report: the key moves with it, and the detail names it.
    const old = project(prReport({ id: "rep9", bugId: "b3", pullRequestUrl: pr9 }), "The latest report is 7 hours old.");
    const again = itemsFor(agent("working", "owner-eli"), old, nothingMine).find((i) => i.kind === "report_pr_status");
    expect(again!.key).toBe(`report_pr_status:b3:${pr9}:rep9`);
    expect(again!.detail).toContain(`The latest report (open) is from Erin's agent at ${REPORTED_AT.toISOString()}.`);
  });

  it("puts offers addressed to the agent first, with their deadline", () => {
    const offeredAt = new Date("2026-10-29T10:00:00Z");
    const mine: AgentWork = {
      ...nothingMine,
      offers: [{ id: "o1", offeredAt, bug: { id: "b9", number: 9, title: "Offered" } }],
    };
    const items = itemsFor(agent("working"), work({ ready: [{ id: "b1", number: 1, title: "x", importance: 3 }] }), mine);
    expect(items[0]).toMatchObject({ kind: "offer", key: "offer:o1", dueAt: "2026-10-29T10:30:00.000Z" });
    expect(items[0].actions[0]).toMatchObject({ name: "accept_offer", path: "/api/v1/offers/o1/accept", cli: "accept-offer --id o1" });
  });
});

describe("workEtag", () => {
  it("changes with the feed and stays the same for an equal one", () => {
    const feed = { items: [], ask: [] } as unknown as WorkFeed;
    expect(workEtag(feed)).toBe(workEtag({ ...feed }));
    expect(workEtag(feed)).not.toBe(workEtag({ ...feed, ask: ["new"] }));
    expect(workEtag(feed)).toMatch(/^W\/"[\w-]+"$/);
  });
});
