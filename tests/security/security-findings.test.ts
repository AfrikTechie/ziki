import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Private security findings (#security-findings): the details live apart from
 * the shared idea and issue rows, only the reporter, workspace owners and
 * admins and cleared agents read them, and they are published once the fix is
 * live (or an admin publishes them early).
 */
const db = vi.hoisted(() => ({
  agentActivation: { findUnique: vi.fn() },
  agentEvent: { create: vi.fn<(args: unknown) => Promise<{ id: string }>>(async () => ({ id: "event1" })) },
  attachment: { updateMany: vi.fn() },
  bug: { update: vi.fn() },
  idea: { update: vi.fn() },
  securityFinding: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({
  publish: vi.fn(async (client: typeof db, params: unknown) => client.agentEvent.create({ data: params } as never)),
}));

import {
  agentFindingViewer,
  canViewFinding,
  discloseFinding,
  discloseLiveFindings,
  findingView,
  isPrivateFinding,
  placeholderTitle,
  PLACEHOLDER_DESCRIPTION,
  type FindingRow,
  type FindingViewer,
} from "@/lib/security-findings";
import { isSecuritySeverity, SECURITY_SEVERITIES } from "@/lib/security-severity";
import { median } from "@/lib/security-dashboard";
import { createIdeaSchema } from "@/lib/agent-api/ideas";
import { securityJson } from "@/lib/agent-api/issues";

const ORG = "org_zedu";
const REPORTER = "user-reporter";

function row(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: "finding1",
    organisationId: ORG,
    projectId: "project1",
    ideaId: "idea1",
    bugId: null,
    reporterId: REPORTER,
    severity: "high",
    title: "Any member can read another organisation's invoices",
    summary: "IDOR on /api/billing/invoices/:id",
    description: "GET /api/billing/invoices/inv_other returns another workspace's invoice.",
    disclosedAt: null,
    disclosedById: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    attachments: [{ id: "att1", filename: "poc.png", contentType: "image/png", size: 2048, createdAt: new Date("2026-11-01T00:00:00Z") }],
    ...overrides,
  };
}

const person = (userId: string, organisationAdmin = false, organisationId: string | null = ORG): FindingViewer => ({ kind: "person", userId, organisationId, organisationAdmin });
const agent = (ownerId: string, securityCleared = false, organisationId = ORG): FindingViewer => ({ kind: "agent", ownerId, organisationId, securityCleared });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("who may read a private finding", () => {
  it("lets the reporter, workspace admins and cleared agents read it", () => {
    expect(canViewFinding(row(), person(REPORTER))).toBe(true);
    expect(canViewFinding(row(), person("user-admin", true))).toBe(true);
    expect(canViewFinding(row(), agent("user-someone", true))).toBe(true);
  });

  it("lets the reporter's own agents read what their owner reported", () => {
    expect(canViewFinding(row(), agent(REPORTER, false))).toBe(true);
  });

  it("keeps it from other members and uncleared agents", () => {
    expect(canViewFinding(row(), person("user-member"))).toBe(false);
    expect(canViewFinding(row(), agent("user-member", false))).toBe(false);
    expect(canViewFinding(row(), null)).toBe(false);
  });

  it("never lets another workspace's admin or cleared agent in", () => {
    expect(canViewFinding(row(), person("user-admin", true, "org_other"))).toBe(false);
    expect(canViewFinding(row(), agent("user-x", true, "org_other"))).toBe(false);
    expect(canViewFinding(row(), person(REPORTER, false, null))).toBe(false);
  });

  it("is open to everyone once disclosed", () => {
    const disclosed = row({ disclosedAt: new Date("2026-11-05T00:00:00Z") });
    expect(canViewFinding(disclosed, person("user-member"))).toBe(true);
    expect(canViewFinding(disclosed, agent("user-member", false))).toBe(true);
  });
});

describe("what a viewer is shown", () => {
  it("shows a restricted viewer only the severity", () => {
    const view = findingView(row(), person("user-member"));
    expect(view).toMatchObject({ severity: "high", disclosed: false, canView: false, details: null });
    expect(JSON.stringify(view)).not.toContain("invoices");
  });

  it("shows an allowed viewer the details and evidence", () => {
    const view = findingView(row(), person(REPORTER));
    expect(view.details?.title).toContain("invoices");
    expect(view.details?.attachments).toHaveLength(1);
  });

  it("gives agents the API block with file URLs only when allowed", () => {
    expect(securityJson(row(), agent("user-member"))).toMatchObject({ canView: false, details: null, severity: "high" });
    const allowed = securityJson(row(), agent("user-member", true));
    expect(allowed?.details?.attachments[0]).toMatchObject({ id: "att1", url: "/api/v1/attachments/att1" });
    expect(securityJson(null, agent("user-member", true))).toBeNull();
  });

  it("reads an agent's clearance from its activation in the organisation", async () => {
    db.agentActivation.findUnique.mockResolvedValueOnce({ securityCleared: true });
    expect(await agentFindingViewer({ agentId: "agent1", ownerId: "owner1", organisationId: ORG })).toEqual(agent("owner1", true));
    db.agentActivation.findUnique.mockResolvedValueOnce(null);
    expect(await agentFindingViewer({ agentId: "gone", ownerId: "owner1", organisationId: ORG })).toEqual(agent("owner1", false));
  });
});

describe("the placeholder", () => {
  it("names the severity but nothing else", () => {
    expect(placeholderTitle("critical")).toBe("Private security finding (Critical)");
    expect(PLACEHOLDER_DESCRIPTION).toContain("published here automatically once the fix is live");
  });

  it("accepts only the four severities", () => {
    expect(SECURITY_SEVERITIES).toEqual(["critical", "high", "medium", "low"]);
    expect(isSecuritySeverity("high")).toBe(true);
    expect(isSecuritySeverity("urgent")).toBe(false);
    expect(isSecuritySeverity(undefined)).toBe(false);
  });
});

describe("agents filing a finding", () => {
  const base = { title: "Invoices leak across workspaces", description: "A long enough description of the problem.", summary: "Invoices leak across workspaces." };

  it("takes a severity", () => {
    expect(createIdeaSchema.parse({ ...base, security: { severity: "critical" } }).security).toEqual({ severity: "critical" });
  });

  it("refuses an unknown severity or extra keys", () => {
    expect(() => createIdeaSchema.parse({ ...base, security: { severity: "urgent" } })).toThrow();
    expect(() => createIdeaSchema.parse({ ...base, security: { severity: "low", public: true } })).toThrow();
  });
});

describe("disclosing a finding", () => {
  const stored = {
    id: "finding1", organisationId: ORG, projectId: "project1", ideaId: "idea1", bugId: "bug1", severity: "high",
    title: "Real title", summary: "Real summary", description: "Real steps", disclosedAt: null,
  };

  it("copies the real text onto the idea and issue, moves the files and announces it", async () => {
    db.securityFinding.findUnique.mockResolvedValueOnce(stored);
    expect(await discloseFinding(db as never, "finding1", null)).toBe(true);
    const text = { title: "Real title", summary: "Real summary", description: "Real steps" };
    expect(db.idea.update).toHaveBeenCalledWith({ where: { id: "idea1" }, data: text });
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: "bug1" }, data: text });
    expect(db.attachment.updateMany).toHaveBeenCalledWith({ where: { securityFindingId: "finding1" }, data: { ideaId: "idea1", bugId: "bug1" } });
    expect(db.securityFinding.update).toHaveBeenCalledWith({ where: { id: "finding1" }, data: { disclosedAt: expect.any(Date), disclosedById: null } });
    const event = (db.agentEvent.create.mock.calls[0] as unknown as [{ data: { type: string; payload: Record<string, unknown> } }])[0].data;
    expect(event.type).toBe("security.disclosed");
    expect(event.payload).toMatchObject({ findingId: "finding1", reason: "fix_live", severity: "high" });
    expect(JSON.stringify(event.payload)).not.toContain("Real steps");
  });

  it("records who disclosed it early", async () => {
    db.securityFinding.findUnique.mockResolvedValueOnce({ ...stored, bugId: null });
    await discloseFinding(db as never, "finding1", "user-admin");
    expect(db.bug.update).not.toHaveBeenCalled();
    expect(db.securityFinding.update).toHaveBeenCalledWith({ where: { id: "finding1" }, data: { disclosedAt: expect.any(Date), disclosedById: "user-admin" } });
  });

  it("does nothing the second time", async () => {
    db.securityFinding.findUnique.mockResolvedValueOnce({ ...stored, disclosedAt: new Date() });
    expect(await discloseFinding(db as never, "finding1", null)).toBe(false);
    expect(db.idea.update).not.toHaveBeenCalled();
    expect(db.securityFinding.update).not.toHaveBeenCalled();
  });

  it("sweeps only private findings whose issue is Live", async () => {
    db.securityFinding.findMany.mockResolvedValueOnce([{ id: "finding1" }]);
    db.securityFinding.findUnique.mockResolvedValueOnce(stored);
    db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
    expect(await discloseLiveFindings({ organisationId: ORG }, db as never)).toBe(1);
    expect(db.securityFinding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { disclosedAt: null, organisationId: ORG, bug: { status: "resolved", isDeleted: false } },
    }));
  });

  it("knows a finding is still private, so its placeholder can't be edited", async () => {
    db.securityFinding.findFirst.mockResolvedValueOnce({ id: "finding1" });
    expect(await isPrivateFinding({ bugId: "bug1" })).toBe(true);
    expect(db.securityFinding.findFirst).toHaveBeenCalledWith({ where: { bugId: "bug1", disclosedAt: null }, select: { id: true } });
    db.securityFinding.findFirst.mockResolvedValueOnce(null);
    expect(await isPrivateFinding({ ideaId: "idea1" })).toBe(false);
  });
});

describe("time to fix", () => {
  it("takes the median of whole days", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 4])).toBe(4);
    expect(median([2, 4, 6, 10])).toBe(5);
  });
});
