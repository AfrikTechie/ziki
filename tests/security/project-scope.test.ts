import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.hoisted(() => vi.fn());
const publishedTasks = vi.hoisted(() => vi.fn());
const taskCounts = vi.hoisted(() => vi.fn());
const proposalCount = vi.hoisted(() => vi.fn());
const proposals = vi.hoisted(() => vi.fn());
const proposalVotes = vi.hoisted(() => vi.fn());
const myVerdicts = vi.hoisted(() => vi.fn());
const proposalAgents = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst },
    bug: { findMany: publishedTasks, groupBy: taskCounts },
    idea: { count: proposalCount, findMany: proposals },
    ideaVerdict: { groupBy: proposalVotes, findMany: myVerdicts },
    agent: { findMany: proposalAgents },
  },
}));
vi.mock("@/components/marketing/tasks/tasks-board", () => ({ TasksBoard: () => null }));
vi.mock("@/lib/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workflow")>()),
  workflowFor: vi.fn(async () => ({ ideaThreshold: 3, revisionLimit: 2 })),
}));

const section = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  requireProject: vi.fn(),
  firstProjectRefFor: vi.fn(),
  requireUser: vi.fn(async () => ({ id: "ada" })),
}));
vi.mock("next/navigation", () => ({ notFound: section.notFound, redirect: section.redirect }));
vi.mock("@/lib/project-route", () => ({ requireProject: section.requireProject, firstProjectRefFor: section.firstProjectRefFor }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: section.requireUser }));

import MarketingHomePage from "@/app/(app)/[org]/[project]/marketing/page";
import MarketingPage from "@/app/(app)/marketing/page";
import LibraryPage from "@/app/(app)/[org]/[project]/marketing/output-box/page";
import { readLibrary } from "@/app/(app)/[org]/[project]/marketing/output-box/data";
import { readTasksBoard } from "@/app/(app)/[org]/[project]/marketing/data";
import RejectedIdeasPage from "@/app/(app)/[org]/[project]/marketing/ideas/rejected/page";
import { readRejectedIdeas } from "@/app/(app)/[org]/[project]/marketing/ideas/rejected/data";
import { parseTaskView } from "@/components/marketing/tasks/model";
import { AgentProjectError } from "@/lib/agents/require-agent";
import { marketingTabHref } from "@/lib/header-nav";
import { issueProject } from "@/lib/agent-api/issues";
import { projectRef } from "@/lib/project-paths";

const agent = {
  agentId: "agent1",
  name: "Ada's Claude",
  ownerId: "ada",
  tenantId: "tenant_zedu",
  level: "working" as const,
  burst: false,
  keyId: "key1",
};

describe("issueProject project scope (#742)", () => {
  beforeEach(() => {
    findFirst.mockReset();
    findFirst.mockResolvedValue({ id: "project_web" });
  });

  it("allows a legacy key that is not limited to a project", async () => {
    await expect(issueProject({ ...agent, projectId: null }, new URLSearchParams("projectId=project_web"))).resolves.toEqual({
      tenantId: "tenant_zedu",
      projectId: "project_web",
    });
  });

  it("allows a key limited to that project", async () => {
    await expect(
      issueProject(
        { ...agent, projectId: "project_web", projectSlug: "web" },
        new URLSearchParams("projectId=project_web"),
      ),
    ).resolves.toMatchObject({ projectId: "project_web" });
  });

  it("rejects a key limited to another project", async () => {
    await expect(
      issueProject(
        { ...agent, projectId: "project_mobile", projectSlug: "mobile" },
        new URLSearchParams("projectId=project_web"),
      ),
    ).rejects.toBeInstanceOf(AgentProjectError);
  });
});

describe("Library project isolation", () => {
  it("refuses access before reading published deliverables", async () => {
    section.requireProject.mockRejectedValue(new Error("NOT_FOUND"));
    publishedTasks.mockClear();
    await expect(LibraryPage({ params: Promise.resolve({ org: "acme", project: "private" }) })).rejects.toThrow("NOT_FOUND");
    expect(publishedTasks).not.toHaveBeenCalled();
  });

  it("returns only published marketing work in the authorized tenant and project, with the latest delivery", async () => {
    const approved = {
      id: "approved", number: 42, title: "Launch campaign", projectId: "project_web", tenantId: "tenant_zedu",
      track: "marketing", status: "resolved", substatus: "published", isDeleted: false,
      deliveries: [
        { id: "new", updatedAt: new Date("2026-11-03"), summary: "Approved version", deliverableUrls: ["https://example.com/final.png"], agent: { name: "Studio" } },
        { id: "old", updatedAt: new Date("2026-11-01"), summary: "Earlier version", deliverableUrls: ["https://example.com/draft.png"], agent: { name: "Earlier agent" } },
      ],
      mergeReviews: [{ updatedAt: new Date("2026-11-04") }],
      attachments: [{ id: "evidence", filename: "unrelated-evidence.png", contentType: "image/png", size: 20 }],
    };
    const records = [approved,
      { ...approved, id: "other-project", projectId: "project_other" },
      { ...approved, id: "other-tenant", tenantId: "tenant_other" },
      { ...approved, id: "product", track: "product" },
      { ...approved, id: "unpublished", status: "done", substatus: "accepted" },
      { ...approved, id: "deleted", isDeleted: true },
    ];
    publishedTasks.mockImplementation(async ({ where, select }) => records
      .filter((row) => Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value))
      .map((row) => ({ ...row, deliveries: select.deliveries.orderBy[0].updatedAt === "desc" ? [...row.deliveries].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, select.deliveries.take) : row.deliveries })));
    const result = await readLibrary({ tenantId: "tenant_zedu", project: { id: "project_web" } } as Parameters<typeof readLibrary>[0]);
    expect(result).toEqual([expect.objectContaining({
      id: "approved", agent: "Studio", publishedAt: "2026-11-04T00:00:00.000Z",
      files: [expect.objectContaining({ url: "https://example.com/final.png" })],
    })]);
  });
});

describe("the marketing tasks board", () => {
  const context = { tenantId: "tenant_zedu", user: { id: "ada" }, project: { id: "project_web", slug: "web" } } as Parameters<typeof readTasksBoard>[0];
  const scope = { tenantId: "tenant_zedu", projectId: "project_web", track: "marketing", isDeleted: false };
  const rowsOf = (board: Awaited<ReturnType<typeof readTasksBoard>>) => (board.list.kind === "tasks" ? board.list.rows : []);

  beforeEach(() => {
    publishedTasks.mockReset();
    publishedTasks.mockResolvedValue([]);
    taskCounts.mockReset();
    taskCounts.mockResolvedValue([{ status: "open", _count: { _all: 3 } }, { status: "resolved", _count: { _all: 2 } }]);
    proposalCount.mockReset();
    proposalCount.mockResolvedValue(0);
    proposals.mockReset();
    proposals.mockResolvedValue([]);
    proposalVotes.mockReset();
    proposalVotes.mockResolvedValue([]);
    myVerdicts.mockReset();
    myVerdicts.mockResolvedValue([]);
  });

  it("refuses access before reading any task", async () => {
    section.requireProject.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(MarketingHomePage({ params: Promise.resolve({ org: "acme", project: "private" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(publishedTasks).not.toHaveBeenCalled();
    expect(proposals).not.toHaveBeenCalled();
    expect(taskCounts).not.toHaveBeenCalled();
  });

  it("reads this project's marketing issues for the tab, and counts every tab", async () => {
    const board = await readTasksBoard(context, parseTaskView({ status: "live" }));
    expect(publishedTasks.mock.calls[0][0].where).toMatchObject({ ...scope, status: "resolved" });
    expect(taskCounts.mock.calls[0][0].where).toMatchObject(scope);
    expect(taskCounts.mock.calls[0][0].where.status).toBeUndefined();
    expect(board.counts).toEqual({ ideas: 0, open: 3, "in-progress": 0, closed: 0, done: 0, live: 2 });
  });

  it("lists open marketing ideas under Ideas with their votes, and marks the ones you voted on", async () => {
    proposalCount.mockResolvedValue(1);
    proposals.mockResolvedValue([{
      id: "idea_1", number: 12, title: "A launch post", score: 2, createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01"),
      verdicts: [{ updatedAt: new Date("2026-11-02") }], reporter: { name: "Ada" }, category: null, _count: { verdicts: 2 },
    }]);
    proposalVotes.mockResolvedValue([{ ideaId: "idea_1", opinion: "good", _sum: { votes: 3 } }, { ideaId: "idea_1", opinion: "bad", _sum: { votes: 1 } }]);
    myVerdicts.mockResolvedValue([{ ideaId: "idea_1" }]);
    const board = await readTasksBoard(context, parseTaskView({ status: "ideas" }));
    expect(proposals.mock.calls[0][0].where).toMatchObject({ ...scope, status: "open" });
    expect(publishedTasks).not.toHaveBeenCalled();
    expect(board.list).toMatchObject({ kind: "proposals", ideas: [{
      number: 12, threshold: 3, good: 3, badVotes: 1, approvedByMe: true, lastUpdateAt: new Date("2026-11-02"),
    }] });
  });

  it("opens Ideas when the address names no list or an unknown one", async () => {
    expect((await readTasksBoard(context, parseTaskView({}))).tab.param).toBe("ideas");
    expect((await readTasksBoard(context, parseTaskView({ status: "merge" }))).tab.param).toBe("ideas");
  });

  it("names who delivered finished work, but not the last worker of work reopened for bids", async () => {
    const task = {
      id: "t1", number: 41, title: "A launch post", closeReason: null, voteCount: 0, revisionCount: 0, updatedAt: new Date("2026-11-03"), reward: 4,
      rewardEstimateCount: 0, rewardFixedAt: null, project: { slug: "web", tenant: { slug: "acme" } }, type: null, assignee: null, claims: [],
      deliveries: [{ agent: { name: "Studio" } }], _count: { comments: 0, bids: 0 },
    };
    publishedTasks.mockResolvedValue([{ ...task, status: "resolved", substatus: "published" }]);
    expect(rowsOf(await readTasksBoard(context, parseTaskView({ status: "live" })))[0].agentName).toBe("Studio");
    publishedTasks.mockResolvedValue([{ ...task, status: "open", substatus: "open" }]);
    expect(rowsOf(await readTasksBoard(context, parseTaskView({ status: "open" })))[0].agentName).toBeNull();
  });

  it("shows the revision round while work is back with its worker", async () => {
    publishedTasks.mockResolvedValue([{
      id: "t1", number: 41, title: "A launch post", status: "in_progress", substatus: "in_progress", closeReason: null, voteCount: 0, revisionCount: 1,
      updatedAt: new Date("2026-11-03"), reward: 4, rewardEstimateCount: 0, rewardFixedAt: null, project: { slug: "web", tenant: { slug: "acme" } }, type: null, assignee: null,
      claims: [], deliveries: [], _count: { comments: 0, bids: 0 },
    }]);
    expect(rowsOf(await readTasksBoard(context, parseTaskView({ status: "in-progress" })))[0].revision).toBe("Revision 1 of 2");
  });
});

describe("Rejected marketing ideas project isolation", () => {
  const context = {
    tenantId: "tenant_zedu",
    project: { id: "project_web" },
    user: { id: "ada" },
  } as Parameters<typeof readRejectedIdeas>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    proposalCount.mockReset();
    proposalCount.mockResolvedValue(1);
    proposals.mockReset();
    proposals.mockResolvedValue([]);
    proposalAgents.mockReset();
    proposalAgents.mockResolvedValue([]);
  });

  it("refuses access before reading marketing ideas", async () => {
    section.requireProject.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(
      RejectedIdeasPage({ params: Promise.resolve({ org: "acme", project: "private" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(proposals).not.toHaveBeenCalled();
  });

  it("reads rejected and archived marketing ideas only inside the authorized tenant and project", async () => {
    await readRejectedIdeas(context);
    expect(proposals).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: "tenant_zedu", projectId: "project_web", track: "marketing",
        status: { in: ["rejected", "archived"] },
      }),
    }));
  });
});

describe("the marketing section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    section.requireUser.mockResolvedValue({ id: "ada" });
  });

  it("is refused to someone who can't open the project", async () => {
    section.requireProject.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(MarketingHomePage({ params: Promise.resolve({ org: "acme", project: "web" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(section.requireProject).toHaveBeenCalledWith("acme", "web");
  });

  it("sends the Marketing tab and /marketing to the project's section, not Amp", async () => {
    expect(marketingTabHref(projectRef("acme", "web"))).toBe("/acme/web/marketing");
    expect(marketingTabHref(null)).toBe("/marketing");
    section.firstProjectRefFor.mockResolvedValue(projectRef("acme", "web"));
    await expect(MarketingPage()).rejects.toThrow("REDIRECT /acme/web/marketing");
  });

  it("sends someone with no project to their workspaces", async () => {
    section.firstProjectRefFor.mockResolvedValue(null);
    await expect(MarketingPage()).rejects.toThrow("REDIRECT /tenants");
  });
});

describe("project addresses carry the organisation (#project-urls)", () => {
  it("reads an old project-first address as old, and an org/project address as new", async () => {
    const { isProjectFirstPath, issuesPath, projectRef } = await import("@/lib/project-paths");
    expect(isProjectFirstPath("/desktop/ideas/2297")).toBe(true);
    expect(isProjectFirstPath("/desktop/740")).toBe(true);
    expect(isProjectFirstPath("/zedu/desktop/ideas/2297")).toBe(false);
    expect(isProjectFirstPath("/zedu")).toBe(false);
    expect(issuesPath(projectRef("zedu", "desktop"), "in_progress")).toBe("/zedu/desktop/issues/in-progress");
  });

  it("never lets a new project or organisation take a name an address reads as old or as a site page", async () => {
    const { unreservedProjectSlug } = await import("@/lib/project-slug");
    const { tenantSlugCandidate } = await import("@/lib/tenants");
    expect(unreservedProjectSlug("123")).toBe("123-project");
    expect(unreservedProjectSlug("workstream")).toBe("workstream-project");
    expect(tenantSlugCandidate("agents", 0, () => "x2y3")).toBe("agents-x2y3");
    expect(tenantSlugCandidate("zedu", 0)).toBe("zedu");
  });
});
