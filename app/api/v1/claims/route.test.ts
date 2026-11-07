import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() },
  agentActivation: { findUnique: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  project: { findFirst: vi.fn() },
  issueClaim: { findMany: vi.fn() },
}));

const budget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({
  ...(await original<typeof import("@/lib/agents/rate-budget")>()),
  consumeAgentBudget: budget,
}));

import { GET } from "./route";

// A key as it is now (#user-agents): it works in one organisation, where the agent is switched on and its owner belongs.
const key = {
  id: "key-a",
  revokedAt: null,
  lastUsedAt: null,
  organisationId: "org-a",
  agent: {
    id: "agent-a",
    name: "Agent A",
    ownerUserId: "owner-a",
    revokedAt: null,
    username: "agent-a",
    tagline: "Finds the bug first",
    about: "I reproduce, then fix.",
    _count: { skills: 1 },
    owner: { role: "user", memberships: [{ organisationId: "org-a" }] },
  },
};

function request(path = "http://localhost/api/v1/claims?projectId=project-1") {
  return new NextRequest(path, { headers: { authorization: "Bearer ziki_test" } });
}

describe("GET /api/v1/claims (#643)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.agentApiKey.findUnique.mockResolvedValue(key);
    db.agentActivation.findUnique.mockResolvedValue({ level: "working", burst: false, burstUntil: null, deactivatedAt: null });
    budget.mockResolvedValue({ allowed: true });
    db.project.findFirst.mockResolvedValue({ id: "project-1", organisationId: "org-a" });
    db.issueClaim.findMany.mockResolvedValue([]);
  });

  it("requires projectId", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/claims", { headers: { authorization: "Bearer ziki_test" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("projectId") });
  });

  it("lists active claims for the agent owner", async () => {
    const now = new Date("2026-10-29T10:00:00Z");
    db.issueClaim.findMany.mockResolvedValue([
      {
        id: "claim-1",
        status: "active",
        claimedAt: now,
        deliverBy: now,
        agentId: "agent-a",
        beneficiaryUserId: "owner-a",
        bug: {
          id: "bug-1",
          number: 544,
          title: "Fix bug",
          status: "in_progress",
        },
      },
    ]);

    const res = await GET(request());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.claims).toHaveLength(1);
    expect(data.claims[0]).toMatchObject({
      id: "claim-1",
      status: "active",
      issue_id: "bug-1",
      issue_number: 544,
      issue_title: "Fix bug",
      issue_status: "in_progress",
    });
    // Only this owner's live claims, on issues in the key's organisation and the asked project.
    expect(db.issueClaim.findMany.mock.calls[0][0].where).toMatchObject({
      beneficiaryUserId: "owner-a",
      status: "active",
      releasedAt: null,
      bug: { organisationId: "org-a", projectId: "project-1", isDeleted: false },
    });
  });
});
