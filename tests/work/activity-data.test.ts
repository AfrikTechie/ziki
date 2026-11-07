import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Activity page's server side (#849): who sees which agents' work, and the
 * Nudge, which goes out as an ordinary message to the agent.
 */

const membershipFindUnique = vi.hoisted(() => vi.fn());
const agentFindMany = vi.hoisted(() => vi.fn());
const claimFindMany = vi.hoisted(() => vi.fn());
const claimFindUnique = vi.hoisted(() => vi.fn());
const questionFindMany = vi.hoisted(() => vi.fn());
const auditFindMany = vi.hoisted(() => vi.fn());
const sendAgentMessage = vi.hoisted(() => vi.fn());
const holdLoad = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findUnique: membershipFindUnique },
    agent: { findMany: agentFindMany },
    issueClaim: { findMany: claimFindMany, findUnique: claimFindUnique },
    agentQuestion: { findMany: questionFindMany },
    agentAuditEvent: { findMany: auditFindMany },
  },
}));
vi.mock("@/lib/agent-messages", () => ({ sendAgentMessage }));
vi.mock("@/lib/agent-api/capacity", () => ({ holdLoad }));
vi.mock("@/lib/workflow", () => ({
  workflowFor: vi.fn(async () => ({ offerWindowSeconds: 1800, deliveryMinutes: 240, maxActiveClaims: 2 })),
}));

import { loadActivity } from "@/lib/activity/queries";
import { nudgeClaimAgent } from "@/lib/activity/nudge";

const bug = {
  id: "bug-1",
  number: 2306,
  title: "Search results",
  status: "in_progress",
  substatus: "in_progress",
  pullRequestUrl: null,
  projectId: "project-desktop",
  project: { slug: "desktop", name: "Desktop", organisation: { slug: "zedu" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  agentFindMany.mockResolvedValue([{ id: "agent-zeddi", name: "Zeddi" }]);
  claimFindMany.mockResolvedValue([]);
  questionFindMany.mockResolvedValue([]);
  auditFindMany.mockResolvedValue([]);
  holdLoad.mockResolvedValue(1);
});

describe("loadActivity", () => {
  it("returns nothing for someone outside the organisation", async () => {
    membershipFindUnique.mockResolvedValue(null);
    expect(await loadActivity("jennifer", "org-zedu")).toBeNull();
    expect(claimFindMany).not.toHaveBeenCalled();
  });

  it("limits a member to their own agents", async () => {
    membershipFindUnique.mockResolvedValue({ role: "member" });
    await loadActivity("jennifer", "org-zedu");
    // Agents are their owner's, active in the organisations they choose (#user-agents).
    expect(agentFindMany.mock.calls[0][0].where).toMatchObject({
      ownerUserId: "jennifer",
      activations: { some: { organisationId: "org-zedu", deactivatedAt: null } },
    });
    expect(claimFindMany.mock.calls[0][0].where).toMatchObject({ agent: { ownerUserId: "jennifer" }, bug: { organisationId: "org-zedu" } });
  });

  it("shows an admin only their own agents' work too, not the whole organisation's", async () => {
    membershipFindUnique.mockResolvedValue({ id: "membership-1" });
    await loadActivity("jennifer", "org-zedu");
    expect(agentFindMany.mock.calls[0][0].where).toMatchObject({ ownerUserId: "jennifer" });
    expect(claimFindMany.mock.calls[0][0].where.agent).toEqual({ ownerUserId: "jennifer" });
    expect(questionFindMany.mock.calls[0][0].where).toMatchObject({ ownerUserId: "jennifer", answeredAt: null });
  });

  it("shows nothing but the empty board to someone with no agents here", async () => {
    membershipFindUnique.mockResolvedValue({ id: "membership-1" });
    agentFindMany.mockResolvedValue([]);
    const data = await loadActivity("jennifer", "org-zedu");
    expect(data?.claims).toEqual([]);
    expect(claimFindMany).not.toHaveBeenCalled();
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it("matches nothing for an issue filter that isn't a number", async () => {
    membershipFindUnique.mockResolvedValue({ role: "member" });
    const data = await loadActivity("jennifer", "org-zedu", { issueNumber: null });
    expect(data?.claims).toEqual([]);
    expect(claimFindMany).not.toHaveBeenCalled();
  });

  it("turns claims into dated rows with their project's windows and the person's slots", async () => {
    membershipFindUnique.mockResolvedValue({ role: "member" });
    const offeredAt = new Date("2026-11-06T11:45:00Z");
    claimFindMany.mockImplementation(async (args: { where: { releasedAt: unknown } }) =>
      args.where.releasedAt === null
        ? [{
            id: "claim-1", status: "offered", offeredAt, claimedAt: null, deliverBy: null, lastHeartbeatAt: null,
            waitingOnOwnerSince: null, releasedAt: null, releaseReason: null, createdAt: offeredAt,
            agent: { id: "agent-zeddi", name: "Zeddi" }, bug,
          }]
        : [],
    );
    const data = await loadActivity("jennifer", "org-zedu");
    expect(data?.claims[0]).toMatchObject({
      id: "claim-1",
      offeredAt: offeredAt.toISOString(),
      offerWindowSeconds: 1800,
      deliveryMinutes: 240,
      issue: { number: 2306, href: "/zedu/desktop/2306" },
    });
    expect(data?.slots).toEqual([{ project: "Desktop", used: 1, max: 2 }]);
  });

  it("keeps a claim held for plan review, so its owner sees the plan waiting for approval", async () => {
    membershipFindUnique.mockResolvedValue({ role: "member" });
    const claimedAt = new Date("2026-11-06T11:45:00Z");
    claimFindMany.mockImplementation(async (args: { where: { releasedAt: unknown } }) =>
      args.where.releasedAt === null
        ? [{
            id: "claim-plan", status: "planning", offeredAt: null, claimedAt, deliverBy: null, lastHeartbeatAt: null,
            waitingOnOwnerSince: null, releasedAt: null, releaseReason: null, createdAt: claimedAt,
            agent: { id: "agent-zeddi", name: "Zeddi" }, bug,
          }]
        : [],
    );
    const data = await loadActivity("jennifer", "org-zedu");
    expect(data?.claims[0]).toMatchObject({ id: "claim-plan", status: "planning" });
  });
});

describe("nudgeClaimAgent", () => {
  const jennifer = { id: "jennifer", name: "Jennifer" };

  it("sends the agent a message asking it to accept the offer before it expires", async () => {
    claimFindUnique.mockResolvedValue({
      status: "offered", releasedAt: null, offeredAt: new Date("2026-11-06T11:45:00Z"), createdAt: new Date("2026-11-06T11:45:00Z"),
      deliverBy: null, agentId: "agent-zeddi", bug: { number: 2306, title: "Search results", projectId: "project-desktop", isDeleted: false },
    });
    sendAgentMessage.mockResolvedValue({ ok: true, id: "message-1" });
    const result = await nudgeClaimAgent(jennifer, "claim-1");
    expect(result.ok).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith(jennifer, "agent-zeddi", {
      body: 'Nudge from Jennifer: you\'ve been offered #2306 "Search results". Please accept or decline it before the offer expires at 2026-11-06T12:15:00.000Z.',
    });
  });

  it("refuses a claim that has already ended", async () => {
    claimFindUnique.mockResolvedValue({
      status: "released", releasedAt: new Date(), offeredAt: null, createdAt: new Date(), deliverBy: null,
      agentId: "agent-zeddi", bug: { number: 1, title: "x", projectId: "p", isDeleted: false },
    });
    expect(await nudgeClaimAgent(jennifer, "claim-1")).toEqual({ ok: false, error: "That claim has already ended." });
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("passes on the message rule's refusal for someone who may not write to the agent", async () => {
    claimFindUnique.mockResolvedValue({
      status: "active", releasedAt: null, offeredAt: null, createdAt: new Date(), deliverBy: new Date("2026-11-06T16:00:00Z"),
      agentId: "agent-other", bug: { number: 7, title: "Other", projectId: "p", isDeleted: false },
    });
    sendAgentMessage.mockResolvedValue({ ok: false, error: "That agent doesn't exist, or it isn't yours to message." });
    expect(await nudgeClaimAgent(jennifer, "claim-2")).toEqual({ ok: false, error: "That agent doesn't exist, or it isn't yours to message." });
  });
});
