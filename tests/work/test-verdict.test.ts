import { afterSendBack, judgementCounts } from "@/lib/marketing/track";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Judging delivered work (#434, #529, #727, #owner-agents): the agent holding the claim can't judge its own work, anyone else can; one verdict per agent; good to merge needs a ready pull request; weighted judgements move the issue. */
type Row = {
  id: string;
  bugId: string;
  agentId: string;
  onBehalfOfUserId: string;
  goodToMerge: boolean;
  summary: string;
  description: string;
  pullRequestUrl?: string | null;
  changedAt?: Date | null;
};

const state = vi.hoisted(() => ({ verdicts: [] as Row[] }));

const db = vi.hoisted(() => ({
  bug: { findFirst: vi.fn() },
  delivery: { findFirst: vi.fn(), findMany: vi.fn() },
  membership: { findUnique: vi.fn() },
  testVerdict: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  pullRequestReport: { findFirst: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  comment: { create: vi.fn() },
  bugActivity: { create: vi.fn() },
  agentEvent: { create: vi.fn() },
  webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
  jobSubmission: { findUnique: vi.fn(), update: vi.fn() },
  jobReview: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  jobReviewOffer: { findFirst: vi.fn(), update: vi.fn() },
  pointEntry: { createMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const tested = vi.hoisted(() => ({ refreshJudgedStatus: vi.fn() }));
vi.mock("@/lib/agent-api/tested-status", () => ({ refreshJudgedStatus: tested.refreshJudgedStatus }));

const notify = vi.hoisted(() => ({ notifyMergeFailed: vi.fn() }));
vi.mock("@/lib/agent-notifications", () => ({ notifyMergeFailed: notify.notifyMergeFailed }));

const PR = "https://github.com/Zedu-Endor/issue-tracker/pull/42";

/** The latest independent report on the pull request (#pr-reports); by default open, checks passing, no conflict. */
function report(overrides: Record<string, unknown> = {}) {
  return {
    id: "rep1",
    bugId: "bug1",
    pullRequestUrl: PR,
    state: "open",
    mergedInto: null,
    inDefaultBranch: null,
    headSha: null,
    mergeCommitSha: null,
    checks: "passing",
    mergeable: true,
    note: "Checked it on GitHub.",
    agentId: "checker",
    onBehalfOfUserId: "cy",
    createdAt: new Date("2026-10-30T09:00:00Z"),
    agent: { name: "checker" },
    onBehalfOf: { name: "Cy" },
    ...overrides,
  };
}

import { submitTestVerdict } from "@/lib/agent-api/test-verdict";
import { reviewJobSubmission } from "@/lib/jobs/review";

/** An issue Ada filed herself, with no agent and no claim. */
function bugRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bug1",
    organisationId: "organisation_zedu",
    status: "done", substatus: "requires_review",
    pullRequestUrl: PR,
    pullRequestHeadSha: null as string | null,
    title: "A fix",
    assigneeId: "ada",
    project: { repoUrl: "https://github.com/Zedu-Endor/issue-tracker" },
    beneficiaryUserId: "ada",
    createdByAgentId: null,
    createdByAgent: null,
    claims: [],
    ...overrides,
  };
}

function reviewer(id: string, ownerId: string, level: "working" | "manager" | "merger" = "working") {
  return { agentId: id, name: id, ownerId, organisationId: "organisation_zedu", level, burst: false, keyId: `key-${id}` };
}

const files = [{ path: "lib/save.ts", lines: "42" }];
const good = { goodToMerge: true, summary: "Good to merge.", description: "Tested on the branch: it works.", files };
const notGood = (description: string) => ({ goodToMerge: false, summary: "Not good to merge.", description, files });

beforeEach(() => {
  vi.clearAllMocks();
  state.verdicts = [];
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  db.bug.findFirst.mockResolvedValue(bugRow());
  db.delivery.findFirst.mockResolvedValue(null);
  db.delivery.findMany.mockResolvedValue([]);
  db.membership.findUnique.mockResolvedValue({ id: "m1" });
  db.comment.create.mockResolvedValue({ id: "c1" });
  db.bugActivity.create.mockResolvedValue({});
  db.pullRequestReport.findFirst.mockResolvedValue(report());
  db.agentEvent.create.mockResolvedValue({ id: "e1" });
  db.webhookSubscription.findMany.mockResolvedValue([]);
  db.testVerdict.findFirst.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
    // A copy, as Prisma returns: a later update mustn't change what was read.
    const row = state.verdicts.find((v) => v.bugId === where.bugId && v.agentId === where.agentId);
    return row ? { ...row } : null;
  });
  db.testVerdict.create.mockImplementation(async ({ data }: { data: Omit<Row, "id"> }) => {
    const row = { id: `tv${state.verdicts.length + 1}`, changedAt: null, ...data };
    state.verdicts.push(row);
    return row;
  });
  db.testVerdict.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
    const row = state.verdicts.find((v) => v.id === where.id)!;
    Object.assign(row, data);
    return row;
  });
});

describe("submitTestVerdict: who may verdict (#434)", () => {

  it("rejects the agent holding the active claim", async () => {
    db.bug.findFirst.mockResolvedValue(
      bugRow({ claims: [{ status: "active", releasedAt: null, agentId: "r1", agent: { ownerUserId: "rob" } }] }),
    );
    expect(await submitTestVerdict(reviewer("r1", "rob"), "bug1", good)).toMatchObject({
      status: 403,
      error: "fixer_cannot_verdict",
    });
    expect(state.verdicts).toHaveLength(0);
  });

  it("lets the beneficiary's, the filer's and the reporter's own agents judge (#owner-agents)", async () => {
    expect(await submitTestVerdict(reviewer("r3", "ada"), "bug1", good)).toMatchObject({ status: 201 });
    db.bug.findFirst.mockResolvedValue(bugRow({ createdByAgentId: "f1", createdByAgent: { ownerUserId: "rob" } }));
    expect(await submitTestVerdict(reviewer("r2", "rob"), "bug1", good)).toMatchObject({ status: 201 });
    db.bug.findFirst.mockResolvedValue(bugRow({ beneficiaryUserId: null, reporterId: "ada" }));
    expect(await submitTestVerdict(reviewer("r4", "ada"), "bug1", good)).toMatchObject({ status: 201 });
  });

  it("lets the claim holder's owner judge through another agent, but not through the agent holding the claim", async () => {
    db.bug.findFirst.mockResolvedValue(
      bugRow({ claims: [{ status: "active", releasedAt: null, agentId: "w1", agent: { ownerUserId: "rob" } }] }),
    );
    expect(await submitTestVerdict(reviewer("r2", "rob"), "bug1", good)).toMatchObject({ status: 201 });
    expect((await submitTestVerdict(reviewer("w1", "rob"), "bug1", good)).status).toBe(403);
  });

});

describe("submitTestVerdict: the body and record (#434)", () => {
  it("records a good-to-merge verdict for the owner", async () => {
    const result = await submitTestVerdict(reviewer("r1", "rob"), "bug1", good);
    expect(result).toMatchObject({ status: 201, verdict: { goodToMerge: true, onBehalfOfUserId: "rob" } });
    expect(state.verdicts[0]).toMatchObject({ bugId: "bug1", agentId: "r1", onBehalfOfUserId: "rob", goodToMerge: true });
  });

  it("keeps one verdict per agent per issue: reporting again replaces it (#529)", async () => {
    const rob = reviewer("r1", "rob");
    expect(await submitTestVerdict(rob, "bug1", good)).toMatchObject({ status: 201 });
    const changed = await submitTestVerdict(rob, "bug1", notGood("Regresses the Safari login"));
    expect(changed).toMatchObject({ status: 200, changed: true, verdict: { goodToMerge: false, summary: "Not good to merge.", description: "Regresses the Safari login" } });
    expect(state.verdicts).toHaveLength(1);
    expect(state.verdicts[0]).toMatchObject({ goodToMerge: false, changedAt: expect.any(Date) });
  });

});

describe("submitTestVerdict: judges delivered work (#526, #delivered-step)", () => {
  it("is refused until the work is delivered", async () => {
    db.bug.findFirst.mockResolvedValue(bugRow({ pullRequestUrl: null }));
    expect(await submitTestVerdict(reviewer("r1", "rob"), "bug1", good)).toMatchObject({
      status: 409,
      error: "not_delivered",
    });
    expect(db.testVerdict.create).not.toHaveBeenCalled();
  });

  it("refuses a new good-to-merge once the work is Done, and reads no pull request report (#727)", async () => {
    db.bug.findFirst.mockResolvedValue(bugRow({ status: "done", substatus: "accepted" }));
    expect(await submitTestVerdict(reviewer("r3", "rose"), "bug1", good)).toMatchObject({ status: 409, error: "enough_verdicts" });
    expect(db.testVerdict.create).not.toHaveBeenCalled();
    expect(db.pullRequestReport.findFirst).not.toHaveBeenCalled();
    expect(tested.refreshJudgedStatus).not.toHaveBeenCalled();
  });

});

describe("submitTestVerdict: good to merge needs a ready pull request, as reported (#255, #pr-reports)", () => {
  const tester = () => reviewer("r1", "rob");
  const recorded = () => db.testVerdict.create.mock.calls.length + db.testVerdict.update.mock.calls.length;
  /** What the caller is told: the reason, then what the author has to do. Nothing is posted (#review-entries). */
  const refusal = (result: unknown) => {
    expect(db.comment.create).not.toHaveBeenCalled();
    expect(db.bugActivity.create).not.toHaveBeenCalled();
    const { message, todo } = result as { message: string; todo: string };
    return `${message} What to do: ${todo}`;
  };

  it("records nothing while the reported checks are failing, and says what the author has to do", async () => {
    db.pullRequestReport.findFirst.mockResolvedValue(report({ checks: "failing" }));

    const result = await submitTestVerdict(tester(), "bug1", good);

    expect(result).toMatchObject({ status: 409, error: "not_ready", missing: "deployment_verification" });
    expect(recorded()).toBe(0);
    expect(refusal(result)).toMatch(/^The latest report says its checks are failing.*What to do: The author opens the pull request's Checks tab/);
    expect(notify.notifyMergeFailed).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "ada" }));
  });

  it("always records a not-good-to-merge verdict, even when the pull request isn't ready", async () => {
    db.pullRequestReport.findFirst.mockResolvedValue(report({ checks: "failing" }));

    expect(await submitTestVerdict(tester(), "bug1", notGood("It breaks the tab bar."))).toMatchObject({ status: 201 });
    expect(db.comment.create).not.toHaveBeenCalled();
  });
});

describe("submitTestVerdict: a verdict is an entry with a summary and a description (#review-entries)", () => {
  it("refuses a bare verdict with 400, naming the missing field, before touching the issue", async () => {
    const rob = reviewer("r1", "rob");
    expect(await submitTestVerdict(rob, "bug1", { goodToMerge: true })).toMatchObject({ status: 400, error: "invalid_request", field: "summary", message: "Add a summary." });
    expect(await submitTestVerdict(rob, "bug1", { goodToMerge: true, summary: "Good." })).toMatchObject({ status: 400, field: "description" });
    expect(await submitTestVerdict(rob, "bug1", { goodToMerge: true, summary: "One. Two. Three.", description: "x" })).toMatchObject({
      status: 400,
      field: "summary",
      message: "Keep the summary to two sentences.",
    });
    expect(db.bug.findFirst).not.toHaveBeenCalled();
    expect(state.verdicts).toHaveLength(0);
  });
});

describe("submitTestVerdict: marketing work", () => {
  it("records a verdict on delivered marketing work without pull request or files", async () => {
    db.bug.findFirst.mockResolvedValue(
      bugRow({
        track: "marketing",
        pullRequestUrl: null,
        pullRequestHeadSha: null,
      }),
    );
    db.delivery.findFirst.mockResolvedValue({ id: "del-1", updatedAt: new Date() });

    const result = await submitTestVerdict(reviewer("r1", "rob"), "bug1", {
      goodToMerge: true,
      summary: "Looks great.",
      description: "Tested the deliverable copy and links.",
    });

    expect(result).toMatchObject({
      status: 201,
      verdict: {
        goodToMerge: true,
        summary: "Looks great.",
        pullRequestUrl: null,
        headSha: null,
      },
    });
    expect(state.verdicts[0]).toMatchObject({
      goodToMerge: true,
      pullRequestUrl: null,
      headSha: null,
      files: [],
    });
  });

  it("refuses marketing work that has no delivery record", async () => {
    db.bug.findFirst.mockResolvedValue(
      bugRow({
        track: "marketing",
        pullRequestUrl: null,
      }),
    );
    db.delivery.findFirst.mockResolvedValue(null);

    const result = await submitTestVerdict(reviewer("r1", "rob"), "bug1", {
      goodToMerge: true,
      summary: "Looks great.",
      description: "Tested the deliverable copy and links.",
    });

    expect(result).toMatchObject({
      status: 409,
      error: "not_delivered",
    });
  });

  it("requires files for product work", async () => {
    db.bug.findFirst.mockResolvedValue(bugRow({ track: "product" }));

    const result = await submitTestVerdict(reviewer("r1", "rob"), "bug1", {
      goodToMerge: true,
      summary: "Looks great.",
      description: "Tested it.",
    });

    expect(result).toMatchObject({
      status: 400,
      error: "invalid_request",
      field: "files",
    });
  });
});

describe("the Delivered rule after each judgement (#delivered-step)", () => {
  const judged = async () => (await vi.importActual<typeof import("@/lib/agent-api/tested-status")>("@/lib/agent-api/tested-status")).refreshJudgedStatus;
  const PULL = "https://github.com/emerjent/ziki/pull/9";
  function judgedDb(opts: {
    track?: "product" | "marketing";
    revisionCount?: number;
    substatus?: string;
    delivery?: { updatedAt: Date };
    verdicts: { owner: string; good?: boolean; agent?: string; level?: string; updatedAt?: Date }[];
  }) {
    const isMarketing = opts.track === "marketing";
    const bug = {
      id: "bug1",
      organisationId: "t1",
      projectId: "p1",
      status: "done",
      substatus: opts.substatus ?? "requires_review",
      track: opts.track ?? "product",
      revisionCount: opts.revisionCount ?? 0,
      pullRequestUrl: isMarketing ? null : PULL,
      assigneeId: "ada",
      beneficiaryUserId: "ada",
      reporterId: "rex",
      createdByAgentId: null,
      createdByAgent: null,
      claims: [{ id: "claim1", status: "active", claimedAt: new Date(), releasedAt: null, agentId: "solver", beneficiaryUserId: "ada", dispatcherUserId: null, agent: { ownerUserId: "ada" } }],
    };
    const delivery = opts.delivery ?? (isMarketing ? { id: "d1", updatedAt: new Date("2026-11-04T10:00:00Z"), pullRequestUrl: null, beneficiaryUserId: "ada" } : null);
    return {
      bug: { findUnique: vi.fn(async () => bug), update: vi.fn(async () => ({})) },
      delivery: {
        findFirst: vi.fn(async () => delivery),
        findMany: vi.fn(async () => (delivery ? [delivery] : [])),
      },
      testVerdict: {
        findMany: vi.fn(async () =>
          opts.verdicts.map((v, i) => ({
            goodToMerge: v.good ?? true,
            headSha: null,
            pullRequestUrl: isMarketing ? null : PULL,
            updatedAt: v.updatedAt ?? new Date("2026-11-04T12:00:00Z"),
            onBehalfOfUserId: v.owner,
            agent: { id: v.agent ?? `agent-${i}`, ownerUserId: v.owner, activations: [{ organisationId: "t1", level: v.level ?? "working" }] },
          })),
        ),
      },
      issueClaim: { update: vi.fn(async () => ({})) },
      bugActivity: { create: vi.fn(async () => ({})) },
      agentEvent: { create: vi.fn(async () => ({ id: "e1" })) },
      webhookSubscription: { findMany: vi.fn(async () => []) },
      webhookDelivery: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
  }

  it("moves delivered work to Accepted once good judgements weigh 3, and never on one agent alone", async () => {
    const refresh = await judged();
    const three = judgedDb({ verdicts: [{ owner: "rob" }, { owner: "sam" }, { owner: "tia" }] });
    expect(await refresh(three as never, "bug1", "sam")).toBe("accepted");
    expect(three.bug.update).toHaveBeenCalledWith({ where: { id: "bug1" }, data: { status: "done", substatus: "accepted" } });
    expect(await refresh(judgedDb({ verdicts: [{ owner: "rob" }, { owner: "sam" }] }) as never, "bug1", "sam")).toBeNull();
    // A manager agent's judgement weighs 2: not enough alone, enough with one working agent, the same owner's included.
    expect(await refresh(judgedDb({ verdicts: [{ owner: "ada", agent: "ada-manager", level: "manager" }] }) as never, "bug1", "ada")).toBeNull();
    expect(await refresh(judgedDb({ verdicts: [{ owner: "ada", agent: "ada-manager", level: "manager" }, { owner: "ada", agent: "ada-worker" }] }) as never, "bug1", "ada")).toBe("accepted");
  });

  it("sends it back to Open, releasing the claim and clearing the pull request, once as many say not good", async () => {
    const db = judgedDb({ verdicts: [{ owner: "rob", good: false }, { owner: "sam", good: false }, { owner: "tia", good: false }] });
    expect(await (await judged())(db as never, "bug1", "sam")).toBe("open");
    expect(db.issueClaim.update).toHaveBeenCalledWith({ where: { id: "claim1" }, data: { status: "released", releasedAt: expect.any(Date), releaseReason: "judged_not_good" } });
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: "bug1" }, data: { status: "open", substatus: "open", assigneeId: null, pullRequestUrl: null, pullRequestHeadSha: null } });
  });

  it("marketing track: 3 good judgements move delivered work to Accepted without a pull request", async () => {
    const refresh = await judged();
    const db = judgedDb({
      track: "marketing",
      verdicts: [{ owner: "rob" }, { owner: "sam" }, { owner: "tia" }],
    });
    expect(await refresh(db as never, "bug1", "sam")).toBe("accepted");
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: "bug1" }, data: { status: "done", substatus: "accepted" } });
  });

  it("marketing track: not good judgements use up a revision round and return to in_progress (same claim)", async () => {
    const refresh = await judged();
    const db = judgedDb({
      track: "marketing",
      revisionCount: 0,
      verdicts: [{ owner: "rob", good: false }, { owner: "sam", good: false }, { owner: "tia", good: false }],
    });
    expect(await refresh(db as never, "bug1", "sam")).toBe("in_progress");
    expect(db.bug.update).toHaveBeenCalledWith({
      where: { id: "bug1" },
      data: { status: "in_progress", substatus: "in_progress", revisionCount: 1 },
    });
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });

  it("marketing track: reaching revision limit reopens issue for bids and releases claim", async () => {
    const refresh = await judged();
    const db = judgedDb({
      track: "marketing",
      revisionCount: 2,
      verdicts: [{ owner: "rob", good: false }, { owner: "sam", good: false }, { owner: "tia", good: false }],
    });
    expect(await refresh(db as never, "bug1", "sam")).toBe("open");
    expect(db.bug.update).toHaveBeenCalledWith({
      where: { id: "bug1" },
      data: { status: "open", substatus: "open", assigneeId: null, revisionCount: 0 },
    });
    expect(db.issueClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "claim1" },
        data: expect.objectContaining({ status: "released", releaseReason: "judged_not_good" }),
      }),
    );
  });

  it("counts a person's working agents once, and never the agent holding the claim", async () => {
    const refresh = await judged();
    expect(await refresh(judgedDb({ verdicts: [{ owner: "rob", agent: "a1" }, { owner: "rob", agent: "a2" }, { owner: "sam" }] }) as never, "bug1", "rob")).toBeNull();
    expect(await refresh(judgedDb({ verdicts: [{ owner: "ada", agent: "solver" }, { owner: "rob" }, { owner: "sam" }] }) as never, "bug1", "rob")).toBeNull();
    expect(await refresh(judgedDb({ verdicts: [{ owner: "rob" }, { owner: "sam" }, { owner: "ada" }] }) as never, "bug1", "rob")).toBe("accepted");
  });

  it("returns Accepted to Requires review when a judgement changes and the good count drops", async () => {
    const db = judgedDb({ substatus: "accepted", verdicts: [{ owner: "rob" }, { owner: "sam" }] });
    expect(await (await judged())(db as never, "bug1", "sam")).toBe("requires_review");
  });
});

describe("reviewJobSubmission: concurrent accepts (#584)", () => {
  it("serializes verdicts so the last accept sees the first and accepts the row once", async () => {
    const submission = {
      id: "submission-1",
      jobId: "job-1",
      agentId: "submitter-agent",
      beneficiaryUserId: "submitter",
      reviewsNeeded: 2,
      status: "pending",
      reviewedAt: null as Date | null,
      job: { id: "job-1", organisationId: "organisation_zedu", projectId: "p1", pointsPerAccepted: 25 },
    };
    const committedReviews: Array<Record<string, unknown>> = [];
    let awardCount = 0;
    let lockTail = Promise.resolve();

    db.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      let releaseLock: (() => void) | undefined;
      const pendingReviews: Array<Record<string, unknown>> = [];
      const tx = {
        $queryRaw: async () => {
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => { releaseLock = resolve; });
          await previous;
          return [{ id: submission.id }];
        },
        jobSubmission: {
          findUnique: async () => ({ ...submission }),
          update: async ({ data }: { data: Partial<typeof submission> }) => {
            Object.assign(submission, data);
            return { ...submission };
          },
        },
        jobReview: {
          findFirst: async ({ where }: { where: { agentId: string } }) =>
            [...committedReviews, ...pendingReviews].find((row) => row.agentId === where.agentId) ?? null,
          findMany: async () => [...committedReviews, ...pendingReviews],
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const row = { id: `review-${committedReviews.length + pendingReviews.length + 1}`, ...data };
            pendingReviews.push(row);
            return row;
          },
        },
        jobReviewOffer: {
          findFirst: async ({ where }: { where: { agentId: string } }) => ({
            id: `offer-${where.agentId}`,
            deadlineAt: new Date(Date.now() + 60_000),
          }),
          update: async () => ({}),
        },
        pointEntry: {
          createMany: async () => ({ count: ++awardCount === 1 ? 1 : 0 }),
        },
        agentAuditEvent: { create: async () => ({}) },
        agentEvent: { create: async () => ({ id: "job-review-event" }) },
        webhookSubscription: { findMany: async () => [] },
        webhookDelivery: { createMany: async () => ({ count: 0 }) },
      };

      try {
        const result = await callback(tx);
        committedReviews.push(...pendingReviews);
        return result;
      } finally {
        releaseLock?.();
      }
    });

    const [first, second] = await Promise.all([
      reviewJobSubmission(reviewer("reviewer-agent-1", "owner-1"), submission.id, { verdict: "accept" }),
      reviewJobSubmission(reviewer("reviewer-agent-2", "owner-2"), submission.id, { verdict: "accept" }),
    ]);

    expect([first.submission.status, second.submission.status].sort()).toEqual(["accepted", "pending"]);
    expect(submission.status).toBe("accepted");
    expect(committedReviews).toHaveLength(2);
    expect(awardCount).toBe(1);
  });
});

describe("sending marketing work back", () => {
  const marketing = (revisionCount: number) => ({ track: "marketing" as const, revisionCount });

  it("returns it to the same worker until the rounds are used up, then reopens it with a fresh count", () => {
    expect(afterSendBack(marketing(0), 2, "judgement")).toEqual({ substatus: "in_progress", keepsClaim: true, revisionCount: 1 });
    expect(afterSendBack(marketing(1), 2, "judgement")).toEqual({ substatus: "in_progress", keepsClaim: true, revisionCount: 2 });
    expect(afterSendBack(marketing(2), 2, "judgement")).toEqual({ substatus: "open", keepsClaim: false, revisionCount: 0 });
  });

  it("uses up a round when a manager rejects it too", () => {
    expect(afterSendBack(marketing(0), 2, "manager_reject")).toEqual({ substatus: "in_progress", keepsClaim: true, revisionCount: 1 });
    expect(afterSendBack(marketing(2), 2, "manager_reject")).toEqual({ substatus: "open", keepsClaim: false, revisionCount: 0 });
  });

  it("leaves product work as it is: judgements reopen it, a reject returns it", () => {
    const product = { track: "product" as const, revisionCount: 0 };
    expect(afterSendBack(product, 2, "judgement")).toEqual({ substatus: "open", keepsClaim: false, revisionCount: 0 });
    expect(afterSendBack(product, 2, "manager_reject")).toEqual({ substatus: "in_progress", keepsClaim: true, revisionCount: 0 });
  });

  it("counts only judgements since the latest marketing delivery, and product judgements by pull request", () => {
    const delivered = new Date("2026-11-04T10:00:00Z");
    const before = new Date("2026-11-04T09:00:00Z");
    const after = new Date("2026-11-04T11:00:00Z");
    const delivery = { updatedAt: delivered, pullRequestUrl: null };
    expect(judgementCounts("marketing", { updatedAt: before, pullRequestUrl: null }, delivery)).toBe(false);
    expect(judgementCounts("marketing", { updatedAt: after, pullRequestUrl: null }, delivery)).toBe(true);
    const pr = "https://github.com/emerjent/ziki/pull/1";
    expect(judgementCounts("product", { updatedAt: before, pullRequestUrl: pr }, { updatedAt: delivered, pullRequestUrl: pr })).toBe(true);
    expect(judgementCounts("product", { updatedAt: after, pullRequestUrl: "other" }, { updatedAt: delivered, pullRequestUrl: pr })).toBe(false);
  });
});
