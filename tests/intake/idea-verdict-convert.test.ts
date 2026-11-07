import { marketingIdeaFieldsSchema } from "@/lib/validations/marketing";
import { reopenSubstatus, trackRules } from "@/lib/marketing/track";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/lib/agents/require-agent";
import { resetWorkflowCache } from "@/lib/workflow";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";

/** Idea verdicts and conversion (#idea-table, #727): verdict weights, the score, the threshold, conversion to an issue at Requires confirmation, and rejecting a bad idea. */
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  ideaVerdict: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  idea: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
  bug: { create: vi.fn() },
  attachment: { updateMany: vi.fn() },
  securityFinding: { updateMany: vi.fn() },
  issueStake: { updateMany: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn() },
  pointEntry: { createMany: vi.fn() },
  projectWorkflow: { findUnique: vi.fn() },
}));
const publish = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());
const getProjectRewardConfig = vi.hoisted(() => vi.fn(async () => ({ reporter: 2.75 })));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish }));
vi.mock("@/lib/agents/audit", () => ({ audit }));
vi.mock("@/lib/points/platform-rewards", () => ({ getProjectRewardConfig }));

import { convertIdea, convertVettedIdea, giveIdeaVerdict, maxVotesFor, rejectIdea, verdictScore } from "@/lib/agent-api/idea-verdicts";

/** The locked idea row (#idea-table): ideas have their own table, numbers and status. */
const idea = (overrides: Record<string, unknown> = {}) => ({
  id: "i1",
  number: 7,
  organisationId: "t1",
  projectId: "p1",
  status: "open", substatus: "open",
  track: "product",
  score: 3,
  reporterId: "ada",
  beneficiaryUserId: "ada",
  createdByOwnerId: "ada",
  ...overrides,
});

const report = {
  title: "Show an icon for the activity log",
  summary: "The activity list is long and hard to scan without an icon.",
  description: "The activity list is long.",
  typeId: null,
  areaId: null,
  proofLinks: [],
  reporterId: "ada",
  beneficiaryUserId: "ada",
  createdByAgentId: "agent-ada",
};

const input = { opinion: "good" as const, summary: "Useful. It saves a click.", description: "The activity list is long; an icon would keep the page short." };
const person = { organisationId: "t1", userId: "bob" };

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkflowCache();
  db.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(db));
  db.$queryRaw.mockResolvedValue([idea()]);
  db.ideaVerdict.findUnique.mockResolvedValue(null);
  db.ideaVerdict.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: "v1", ...create }));
  db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 1 }]);
  db.pointEntry.createMany.mockResolvedValue({ count: 1 });
  db.projectWorkflow.findUnique.mockResolvedValue(null);
  getProjectRewardConfig.mockResolvedValue({ reporter: 2.75 });
  db.idea.findUniqueOrThrow.mockResolvedValue(report);
  db.bug.create.mockResolvedValue({ id: "b9", number: 42 });
});

describe("the verdict rules", () => {

  it("gives managers and mergers up to the project's manager vote weight, everyone else 1", () => {
    for (const weight of [3, 4]) {
      expect(maxVotesFor(person, weight)).toBe(1);
      expect(maxVotesFor({ ...person, agent: { id: "a", level: "working" } }, weight)).toBe(1);
      expect(maxVotesFor({ ...person, agent: { id: "a", level: "manager" } }, weight)).toBe(weight);
      expect(maxVotesFor({ ...person, agent: { id: "a", level: "merger" } }, weight)).toBe(weight);
    }
  });

  it("scores good minus bad, neutral adding nothing", () => {
    expect(verdictScore([{ opinion: "good", votes: 5 }, { opinion: "bad", votes: 1 }, { opinion: "neutral", votes: 3 }])).toBe(4);
  });
});

describe("giveIdeaVerdict", () => {
  // An idea still short of the threshold (3), so a good verdict counts.
  beforeEach(() => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
  });

  it("records the verdict on the idea, rescores it and pays the first point", async () => {
    const result = await giveIdeaVerdict(person, "p1", "7", input);
    expect(db.ideaVerdict.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ideaId_onBehalfOfUserId_weightClass: { ideaId: "i1", onBehalfOfUserId: "bob", weightClass: "working" } },
      create: expect.objectContaining({ ideaId: "i1", weightClass: "working", opinion: "good", summary: input.summary, description: input.description }),
    }));
    expect(db.idea.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { score: 1 } });
    expect(db.pointEntry.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: "bob", role: "idea", points: 0.01, bugId: null, ideaId: "i1", sourceKey: "idea:i1:bob" })],
      skipDuplicates: true,
    });
    expect(result).toMatchObject({ ideaScore: 1, ideaThreshold: 3, convertible: false, replaced: false, pointsAwarded: 0.01 });
    // An idea's event names its project: there is no issue for the trigger to read it from.
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "idea.verdict",
      projectId: "p1",
      payload: expect.objectContaining({ ideaId: "i1", ideaNumber: 7 }),
    }));
    expect(publish.mock.calls[0][1]).not.toHaveProperty("bugId");
  });

  it("replaces the person's earlier verdict without paying again", async () => {
    db.ideaVerdict.findUnique.mockResolvedValue({ id: "v1" });
    db.pointEntry.createMany.mockResolvedValue({ count: 0 });
    const result = await giveIdeaVerdict(person, "p1", "i1", { ...input, opinion: "bad" });
    expect(result).toMatchObject({ replaced: true, pointsAwarded: 0 });
  });

  it("takes a verdict from the idea's own reporter, and pays it (#owner-agents)", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
    const result = await giveIdeaVerdict({ organisationId: "t1", userId: "ada" }, "p1", "i1", input);
    expect(result).toMatchObject({ replaced: false, pointsAwarded: 0.01 });
    expect(db.ideaVerdict.upsert).toHaveBeenCalled();
  });

  it("refuses votes on marketing ideas already rejected or converted", async () => {
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", status: "rejected" })]);
    await expect(giveIdeaVerdict(person, "p1", "i1", input)).rejects.toMatchObject({ status: 409, body: { error: "idea_rejected" } });
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", status: "converted" })]);
    await expect(giveIdeaVerdict(person, "p1", "i1", input)).rejects.toMatchObject({ status: 409, body: { error: "idea_converted" } });
    expect(db.ideaVerdict.upsert).not.toHaveBeenCalled();
    expect(db.pointEntry.createMany).not.toHaveBeenCalled();
  });

  it("locks the idea inside its organisation and project before applying a verdict", async () => {
    await giveIdeaVerdict(person, "p1", "7", input);
    const [query, organisationId, projectId] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray, string, string, ...unknown[]];
    const sql = query.join("?");
    expect(organisationId).toBe("t1");
    expect(projectId).toBe("p1");
    expect(sql).toContain('WHERE i."organisationId" = ?');
    expect(sql).toContain('AND i."projectId" = ?');
    expect(sql).toContain("FOR NO KEY UPDATE OF i");
  });

  it("refuses another good verdict once the idea reached the threshold, and pays nothing (#727)", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 3 })]);
    await expect(giveIdeaVerdict(person, "p1", "i1", input)).rejects.toMatchObject({
      status: 409,
      body: { error: "enough_verdicts", ideaScore: 3, ideaThreshold: 3 },
    });
    // A bad verdict on the way in doesn't turn it into a good one either.
    db.ideaVerdict.findUnique.mockResolvedValue({ id: "v1", opinion: "bad" });
    await expect(giveIdeaVerdict(person, "p1", "i1", input)).rejects.toMatchObject({ status: 409, body: { error: "enough_verdicts" } });
    expect(db.ideaVerdict.upsert).not.toHaveBeenCalled();
    expect(db.pointEntry.createMany).not.toHaveBeenCalled();
  });

  it("still takes a bad verdict at the threshold, so a late problem can stop the idea (#727)", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 3 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 3 }, { opinion: "bad", votes: 1 }]);
    const result = await giveIdeaVerdict(person, "p1", "i1", { ...input, opinion: "bad" });
    expect(result).toMatchObject({ ideaScore: 2, convertible: false });
    expect(db.ideaVerdict.upsert).toHaveBeenCalled();
  });

  it("refuses more votes than the giver may give", async () => {
    await expect(giveIdeaVerdict(person, "p1", "i1", { ...input, votes: 2 })).rejects.toMatchObject({ status: 422, body: { error: "too_many_votes", maxVotes: 1 } });
    expect(db.ideaVerdict.upsert).not.toHaveBeenCalled();
  });

  it("awards the existing idea-vote points for a marketing verdict", async () => {
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 0 })]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({ pointsAwarded: 0.01, replaced: false });
    expect(db.pointEntry.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        userId: "bob",
        role: "idea",
        points: 0.01,
        ideaId: "i1",
        sourceKey: "idea:i1:bob",
      })],
      skipDuplicates: true,
    });
  });

  it("opens a marketing idea on the verdict that reaches its threshold, with no agent converting it", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW);
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 2 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 2 }, { opinion: "good", votes: 1 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({ ideaScore: 3, convertible: false, decided: { outcome: "converted", issueId: "b9", issueNumber: 42 } });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ track: "marketing", status: "open", substatus: "open" }),
    }));
  });

  it("leaves a product idea at its threshold for an agent to convert", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW);
    db.$queryRaw.mockResolvedValue([idea({ track: "product", score: 2 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 2 }, { opinion: "good", votes: 1 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({ ideaScore: 3, convertible: true, decided: null });
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("doesn't open a bad marketing idea at its threshold: a manager agent rejects it", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue(DEFAULT_PROJECT_WORKFLOW);
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 2 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 3 }, { opinion: "neutral", votes: 4 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({ ideaScore: 3, decided: null });
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("converts a marketing idea to Open in the vote transaction under threshold-only governance", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue({ ...DEFAULT_PROJECT_WORKFLOW, governance: "threshold" });
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 2 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "good", votes: 2 }, { opinion: "good", votes: 1 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", input);

    expect(result).toMatchObject({
      ideaScore: 3,
      convertible: false,
      decided: { outcome: "converted", issueId: "b9", issueNumber: 42 },
    });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ track: "marketing", status: "open", substatus: "open" }),
    }));
    expect(db.pointEntry.createMany).toHaveBeenNthCalledWith(1, {
      data: [expect.objectContaining({ userId: "bob", role: "idea", points: 0.01, ideaId: "i1" })],
      skipDuplicates: true,
    });
    expect(db.pointEntry.createMany).toHaveBeenNthCalledWith(2, {
      data: [expect.objectContaining({ userId: "ada", bugId: "b9", role: "reporter", points: 2.75, sourceKey: "reporter:b9:ada" })],
      skipDuplicates: true,
    });
  });

  it("rejects a bad marketing idea in the vote transaction under threshold-only governance", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue({ ...DEFAULT_PROJECT_WORKFLOW, governance: "threshold" });
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing", score: 1 })]);
    db.ideaVerdict.findMany.mockResolvedValue([{ opinion: "bad", votes: 2 }, { opinion: "bad", votes: 1 }]);

    const result = await giveIdeaVerdict(person, "p1", "7", { ...input, opinion: "bad" });

    expect(result).toMatchObject({ ideaScore: -3, convertible: false, decided: { outcome: "rejected" } });
    expect(db.idea.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "rejected", rejectedAt: expect.any(Date), rejectedByAgentId: null },
    });
    expect(db.bug.create).not.toHaveBeenCalled();
  });

});

describe("convertIdea", () => {
  const agentOf = (level: AgentContext["level"], ownerId = "dana"): AgentContext => ({
    agentId: `agent-${ownerId}`, name: ownerId, ownerId, organisationId: "t1", level, burst: false, keyId: "k1",
  });

  it("creates the issue from the idea's report, moves its files, and marks the idea converted", async () => {
    const result = await convertIdea(agentOf("working"), "p1", "7", "complex");
    expect(result).toMatchObject({ ideaId: "i1", ideaNumber: 7, issueId: "b9", issueNumber: 42, ideaScore: 3, ideaThreshold: 3, difficulty: "complex" });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organisationId: "t1",
        projectId: "p1",
        title: report.title,
        summary: report.summary,
        description: report.description,
        reporterId: "ada",
        beneficiaryUserId: "ada",
        createdByAgentId: "agent-ada",
        status: "open", substatus: "requires_confirmation",
        // #plan-review: the converter's call; a complex issue's award goes through plan review.
        difficulty: "complex",
      }),
    }));
    expect(db.attachment.updateMany).toHaveBeenCalledWith({ where: { ideaId: "i1" }, data: { bugId: "b9" } });
    expect(db.idea.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "converted", convertedAt: expect.any(Date), convertedByAgentId: "agent-dana", issueId: "b9" },
    });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "issue.converted",
      bugId: "b9",
      payload: expect.objectContaining({ ideaId: "i1", issueId: "b9", issueNumber: 42 }),
    }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), "idea.converted", "idea:i1", expect.objectContaining({ issueId: "b9" }), { bugId: "b9" });
  });

  it("converts marketing ideas straight to Open and pays the beneficiary from project reporter rewards", async () => {
    db.$queryRaw.mockResolvedValue([idea({ track: "marketing" })]);

    const result = await convertIdea(agentOf("working"), "p1", "7", "medium");

    expect(result).toMatchObject({ issueId: "b9", issueNumber: 42 });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        track: "marketing",
        status: "open",
        substatus: "open",
      }),
    }));
    expect(getProjectRewardConfig).toHaveBeenCalledWith(db, "p1");
    expect(db.pointEntry.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        organisationId: "t1",
        userId: "ada",
        bugId: "b9",
        role: "reporter",
        points: 2.75,
        sourceKey: "reporter:b9:ada",
        agentId: "agent-ada",
      })],
      skipDuplicates: true,
    });
  });

  it("needs an open idea and a score at the threshold", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 2 })]);
    await expect(convertIdea(agentOf("working"), "p1", "i1", "medium")).rejects.toMatchObject({ status: 409, body: { error: "below_threshold", ideaScore: 2, ideaThreshold: 3 } });
    db.$queryRaw.mockResolvedValue([idea({ status: "converted" })]);
    await expect(convertIdea(agentOf("working"), "p1", "i1", "medium")).rejects.toMatchObject({ status: 409, body: { error: "idea_converted" } });
    expect(db.bug.create).not.toHaveBeenCalled();
    expect(db.idea.update).not.toHaveBeenCalled();
  });
});

/** Already vetted: an idea its owner says was approved elsewhere becomes an issue at once, with no verdicts. */
describe("convertVettedIdea", () => {
  const owner: AgentContext = { agentId: "agent-ada", name: "ada", ownerId: "ada", organisationId: "t1", level: "working", burst: false, keyId: "k1" };

  it("converts an idea with no verdicts, says it was vetted on the issue's activity and on the event, and nothing else is skipped", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0 })]);
    const result = await convertVettedIdea(db as never, owner, "p1", "i1", "Approved by Mark, sheet row 42", "medium");
    expect(result).toMatchObject({ ideaId: "i1", issueId: "b9", issueNumber: 42, ideaScore: 0 });
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "open", substatus: "requires_confirmation",
        activities: { create: expect.objectContaining({ summary: expect.stringContaining("marked already vetted: Approved by Mark, sheet row 42"), metadata: { fromIdea: 7, vettedNote: "Approved by Mark, sheet row 42" } }) },
      }),
    }));
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "issue.converted",
      payload: expect.objectContaining({ via: "already_vetted", decidedByUserId: "ada", vettedNote: "Approved by Mark, sheet row 42" }),
    }));
  });

  it("does not convert an idea that is not open", async () => {
    db.$queryRaw.mockResolvedValue([idea({ score: 0, status: "rejected" })]);
    await expect(convertVettedIdea(db as never, owner, "p1", "i1", "Approved by Mark", "medium")).rejects.toMatchObject({ status: 409, body: { error: "idea_rejected" } });
    expect(db.bug.create).not.toHaveBeenCalled();
  });
});

describe("rejectIdea (#idea-rejected)", () => {
  const manager = (level: AgentContext["level"], ownerId = "dana"): AgentContext => ({
    agentId: `agent-${ownerId}`, name: ownerId, ownerId, organisationId: "t1", level, burst: false, keyId: "k1",
  });
  const verdicts = (good: number, bad: number) => [
    ...Array.from({ length: good }, () => ({ opinion: "good", votes: 1 })),
    ...Array.from({ length: bad }, () => ({ opinion: "bad", votes: 1 })),
  ];

  it("rejects a bad idea (votes reach the threshold, more bad than good), and says so", async () => {
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(2, 4));
    const result = await rejectIdea(manager("manager"), "p1", "7");
    expect(result).toMatchObject({ ideaId: "i1", ideaNumber: 7, status: "rejected", totalVotes: 6, goodVotes: 2 });
    expect(db.idea.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "rejected", rejectedAt: expect.any(Date), rejectedByAgentId: "agent-dana" },
    });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({
      type: "idea.rejected",
      projectId: "p1",
      payload: expect.objectContaining({ ideaId: "i1", ideaNumber: 7, totalVotes: 6, goodVotes: 2 }),
    }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), "idea.rejected", "idea:i1", { totalVotes: 6, goodVotes: 2 });
  });

  it("needs a manager agent", async () => {
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(0, 6));
    await expect(rejectIdea(manager("working"), "p1", "i1")).rejects.toMatchObject({ name: "AgentLevelError" });
    expect(db.idea.update).not.toHaveBeenCalled();
  });

  it("refuses an idea below the idea threshold, or with as many good votes as others, as not_rejectable", async () => {
    // The project's idea threshold is the default, 3.
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(0, 2));
    await expect(rejectIdea(manager("manager"), "p1", "i1")).rejects.toMatchObject({ status: 409, body: { error: "not_rejectable", totalVotes: 2, goodVotes: 0 } });
    db.ideaVerdict.findMany.mockResolvedValue(verdicts(2, 2));
    await expect(rejectIdea(manager("manager"), "p1", "i1")).rejects.toMatchObject({ status: 409, body: { error: "not_rejectable", totalVotes: 4, goodVotes: 2 } });
    expect(db.idea.update).not.toHaveBeenCalled();
  });

});

describe("the marketing track at conversion", () => {
  it("skips confirmation for marketing and keeps it for product", () => {
    expect(trackRules("marketing").convertsTo).toBe("open");
    expect(trackRules("product").convertsTo).toBe("requires_confirmation");
  });

  it("reopens marketing work to Open, with no confirmation step to return to", () => {
    expect(reopenSubstatus("marketing", false)).toBe("open");
    expect(reopenSubstatus("product", false)).toBe("requires_confirmation");
    expect(reopenSubstatus("product", true)).toBe("open");
  });

  it("refuses a marketing idea that doesn't say why it is worth doing", () => {
    expect(marketingIdeaFieldsSchema.safeParse({ track: "marketing" }).success).toBe(false);
    expect(marketingIdeaFieldsSchema.safeParse({ track: "marketing", rationale: "   " }).success).toBe(false);
    expect(marketingIdeaFieldsSchema.safeParse({ track: "marketing", rationale: "People keep asking." }).success).toBe(true);
  });
});
