import { beforeEach, describe, expect, it, vi } from "vitest";

/** Project settings (#595, #vote-governance): only workspace admins change a project's workflow, values are range-checked, and a saved change takes effect at once. The marketing settings actions (M-UI-7) share the area, at the bottom. */
const requireUser = vi.hoisted(() => vi.fn());
const requireProject = vi.hoisted(() => vi.fn());
const isTenantAdmin = vi.hoisted(() => vi.fn());
const assertMarketingSettingsAccess = vi.hoisted(() => vi.fn());
const updateMarketingSettings = vi.hoisted(() => vi.fn());
const typeFindFirst = vi.hoisted(() => vi.fn());
const typeCreate = vi.hoisted(() => vi.fn());
const typeUpdate = vi.hoisted(() => vi.fn());
const typeDelete = vi.hoisted(() => vi.fn());
const bugCount = vi.hoisted(() => vi.fn());
const ideaCount = vi.hoisted(() => vi.fn());
const bugActivityCreateMany = vi.hoisted(() => vi.fn());
const currentTenantIdFor = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const updateTag = vi.hoisted(() => vi.fn());
const invalidateWorkflow = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
const upsert = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath, updateTag }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser }));
vi.mock("@/lib/project-route", () => ({ requireProject }));
vi.mock("@/lib/marketing/settings", () => ({ assertMarketingSettingsAccess, updateMarketingSettings }));
vi.mock("@/lib/agents/membership", () => ({
  isTenantAdmin,
  isTenantAdminRole: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantIdFor,
  NO_TENANT_MESSAGE: "You're not a member of a workspace yet.",
}));
vi.mock("@/lib/workflow", () => ({ invalidateWorkflow }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst },
    projectWorkflow: { upsert },
    projectAuditEvent: { create: auditCreate },
    issueType: { findFirst: typeFindFirst, create: typeCreate, update: typeUpdate, delete: typeDelete },
    bug: { count: bugCount },
    idea: { count: ideaCount },
    bugActivity: { createMany: bugActivityCreateMany },
    $transaction: transaction,
  },
}));

import { updateProjectWorkflowAction } from "@/app/(app)/projects/[slug]/settings/workflow-actions";
import {
  createMarketingIssueTypeAction,
  deleteMarketingIssueTypeAction,
  updateMarketingRevisionLimitAction,
} from "@/app/(app)/[org]/[project]/marketing/settings/actions";
import { IssueApiError } from "@/lib/agent-api/errors";
import {
  DEFAULT_PROJECT_WORKFLOW,
  revisionLimitSchema,
  workflowSettingsSchema,
  workflowValues } from "@/lib/workflow-config";
import { projectRef } from "@/lib/project-paths";

function form(values: Record<string, string | number | boolean> = {}) {
  const data = new FormData();
  data.set("slug", "web");
  const merged = {
    ideaThreshold: 3,
    // One more than the default (3), so a plain save is a change.
    confirmationsNeeded: 4,
    verdictsNeeded: 3,
    offerWindowSeconds: 1800,
    heartbeatMinutes: 240,
    deliveryMinutes: 240,
    maxActiveClaims: 10,
    volunteerWindowSeconds: 120,
    autoMerge: true,
    abandonCheckMinutes: 120,
    abandonThreshold: 3,
    closeThreshold: 3,
    governance: "manager",
    managerVoteWeight: 3,
    awardThreshold: 3,
    acceptThreshold: 3,
    stakeLimit: 2,
    stakeInProgressLimit: 2,
    ...values,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === "boolean") {
      if (value) data.set(key, "on");
    } else {
      data.set(key, String(value));
    }
  }
  return data;
}

const WEB = projectRef("acme", "web");

describe("updateProjectWorkflowAction (#595)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "admin" });
    isTenantAdmin.mockResolvedValue(true);
    currentTenantIdFor.mockResolvedValue("tenant-1");
    findFirst.mockResolvedValue({ id: "project-1", slug: "web", workflow: null });
    transaction.mockImplementation(async (run: (tx: unknown) => unknown) =>
      run({
        projectWorkflow: { upsert },
        projectAuditEvent: { create: auditCreate },
      }),
    );
  });

  it("refuses a member who is not an admin", async () => {
    isTenantAdmin.mockResolvedValue(false);
    await expect(updateProjectWorkflowAction(undefined, form())).resolves.toMatchObject({ ok: false });
    expect(findFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range value without writing", async () => {
    await expect(updateProjectWorkflowAction(undefined, form({ confirmationsNeeded: 6 }))).resolves.toMatchObject({
      ok: false,
      fieldErrors: { confirmationsNeeded: expect.stringContaining("at most 5") },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("saves a change, audits it and invalidates the cache", async () => {
    await expect(updateProjectWorkflowAction(undefined, form())).resolves.toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      update: expect.objectContaining({ confirmationsNeeded: 4 }),
      create: expect.objectContaining({ projectId: "project-1", confirmationsNeeded: 4 }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        projectId: "project-1",
        actorUserId: "admin",
        action: "workflow.updated",
        changes: { confirmationsNeeded: { from: 3, to: 4 } },
      }),
    });
    expect(invalidateWorkflow).toHaveBeenCalledWith("project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/web/settings");
  });

  it("saves the vote governance settings, and refuses an unknown mode (#vote-governance)", async () => {
    await expect(
      updateProjectWorkflowAction(undefined, form({ governance: "threshold", managerVoteWeight: 4, awardThreshold: 5, acceptThreshold: 6 })),
    ).resolves.toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ governance: "threshold", managerVoteWeight: 4, awardThreshold: 5, acceptThreshold: 6 }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          governance: { from: "manager", to: "threshold" },
          managerVoteWeight: { from: 3, to: 4 },
          awardThreshold: { from: 3, to: 5 },
          acceptThreshold: { from: 3, to: 6 },
        }),
      }),
    });
    transaction.mockClear();
    await expect(updateProjectWorkflowAction(undefined, form({ governance: "anarchy" }))).resolves.toMatchObject({
      ok: false,
      fieldErrors: { governance: expect.any(String) },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not report success when persistence fails", async () => {
    transaction.mockRejectedValueOnce(new Error("database down"));
    await expect(updateProjectWorkflowAction(undefined, form())).resolves.toMatchObject({ ok: false });
    expect(invalidateWorkflow).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("leaves the marketing revision limit alone when the product settings are saved", async () => {
    await expect(updateProjectWorkflowAction(undefined, form())).resolves.toEqual({ ok: true });
    const saved = upsert.mock.calls[0][0];
    expect(saved.update).not.toHaveProperty("revisionLimit");
    expect(saved.create).not.toHaveProperty("revisionLimit");
  });

  it("does not touch a project outside the tenant", async () => {
    findFirst.mockResolvedValue(null);
    await expect(updateProjectWorkflowAction(undefined, form())).resolves.toMatchObject({
      ok: false,
      error: expect.any(String),
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("project workflow defaults (#595)", () => {

  it("uses defaults for a missing row", () => {
    expect(workflowValues(null)).toEqual(DEFAULT_PROJECT_WORKFLOW);
    expect(workflowValues({ confirmationsNeeded: 4 })).toMatchObject({
      confirmationsNeeded: 4,
      verdictsNeeded: 3,
      autoMerge: true,
    });
  });
});

describe("workflowSettingsSchema (#595)", () => {
  const valid = { ...DEFAULT_PROJECT_WORKFLOW };

  it("refuses values outside the documented ranges", () => {
    for (const [field, value] of [
      ["confirmationsNeeded", 0],
      ["confirmationsNeeded", 6],
      ["verdictsNeeded", 0],
      ["verdictsNeeded", 6],
      ["offerWindowSeconds", 29],
      ["offerWindowSeconds", 3601],
      ["abandonCheckMinutes", -1],
      ["abandonCheckMinutes", 10081],
      ["abandonThreshold", 0],
      ["abandonThreshold", 101],
      ["closeThreshold", 0],
      ["closeThreshold", 101],
    ] as const) {
      expect(workflowSettingsSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
    }
  });

});

describe("the marketing revision limit", () => {
  it("is 2 until a project sets its own", () => {
    expect(workflowValues(null).revisionLimit).toBe(2);
    expect(workflowValues({ revisionLimit: 4 }).revisionLimit).toBe(4);
  });

  it("refuses a limit outside 1 to 10", () => {
    for (const value of [0, 11, 1.5]) expect(revisionLimitSchema.safeParse(value).success).toBe(false);
    for (const value of [1, 10]) expect(revisionLimitSchema.safeParse(value).success).toBe(true);
  });

  it("reads the project's stored limit", async () => {
    const { workflowFor } = await vi.importActual<typeof import("@/lib/workflow")>("@/lib/workflow");
    const stored = { projectWorkflow: { findUnique: vi.fn(async () => ({ revisionLimit: 5 })) } };
    await expect(workflowFor("project-1", stored as never)).resolves.toMatchObject({ revisionLimit: 5 });
    expect(stored.projectWorkflow.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ revisionLimit: true }) }),
    );
  });
});

describe("the marketing settings actions (M-UI-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireProject.mockResolvedValue({
      user: { id: "admin", role: null },
      tenantId: "tenant-1",
      project: { id: "project-1", slug: "web", name: "Web", tenantId: "tenant-1" },
    });
    assertMarketingSettingsAccess.mockResolvedValue(undefined);
    typeFindFirst.mockResolvedValue(null);
  });

  function revisionForm(value: string | number) {
    const data = new FormData();
    data.set("revisionLimit", String(value));
    return data;
  }

  function typeForm(values: Record<string, string> = {}) {
    const data = new FormData();
    data.set("name", values.name ?? "Email newsletter");
    data.set("description", values.description ?? "");
    data.set("isActive", "true");
    return data;
  }

  it("saves the revision limit through the marketing lib and revalidates the section", async () => {
    updateMarketingSettings.mockResolvedValue({ projectId: "project-1", slug: "web", name: "Web", revisionLimit: 3 });
    await expect(updateMarketingRevisionLimitAction(WEB, revisionForm(3))).resolves.toEqual({ ok: true });
    expect(updateMarketingSettings).toHaveBeenCalledWith("tenant-1", "project-1", "admin", { revisionLimit: 3 });
    expect(revalidatePath).toHaveBeenCalledWith("/acme/web/marketing/settings");
  });

  it("refuses a limit outside 1 to 10 without saving", async () => {
    await expect(updateMarketingRevisionLimitAction(WEB, revisionForm(11))).resolves.toMatchObject({
      error: expect.any(String),
    });
    expect(updateMarketingSettings).not.toHaveBeenCalled();
  });

  it("refuses a member before saving", async () => {
    assertMarketingSettingsAccess.mockRejectedValue(
      new IssueApiError(403, "Only workspace owners and admins can change marketing settings."),
    );
    await expect(updateMarketingRevisionLimitAction(WEB, revisionForm(3))).resolves.toMatchObject({
      error: expect.stringContaining("owners and admins"),
    });
    expect(updateMarketingSettings).not.toHaveBeenCalled();
  });

  it("stores a new type on the marketing track", async () => {
    await expect(createMarketingIssueTypeAction(WEB, typeForm({ name: "Email newsletter" }))).resolves.toEqual({
      ok: true,
    });
    expect(typeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: "tenant-1", name: "Email newsletter", track: "marketing" }),
      }),
    );
  });

  it("stores a type as inactive when the Active box is unticked", async () => {
    const form = typeForm({ name: "Email newsletter" });
    form.delete("isActive");
    await expect(createMarketingIssueTypeAction(WEB, form)).resolves.toEqual({ ok: true });
    expect(typeCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it("refuses a name a type already uses, across tracks", async () => {
    typeFindFirst.mockResolvedValueOnce({ name: "Blog post" });
    await expect(createMarketingIssueTypeAction(WEB, typeForm({ name: "blog post" }))).resolves.toMatchObject({
      error: expect.stringContaining("Blog post"),
    });
    expect(typeCreate).not.toHaveBeenCalled();
  });

  it("refuses to delete a type marketing tasks still use, and says to deactivate instead", async () => {
    typeFindFirst.mockResolvedValue({ id: "type-1" });
    bugCount.mockResolvedValue(2);
    ideaCount.mockResolvedValue(0);
    await expect(deleteMarketingIssueTypeAction(WEB, "type-1")).resolves.toMatchObject({
      error: expect.stringContaining("Deactivate it instead"),
    });
    expect(typeDelete).not.toHaveBeenCalled();
  });

  it("deletes a type no task uses", async () => {
    typeFindFirst.mockResolvedValue({ id: "type-1" });
    bugCount.mockResolvedValue(0);
    ideaCount.mockResolvedValue(0);
    await expect(deleteMarketingIssueTypeAction(WEB, "type-1")).resolves.toEqual({ ok: true });
    expect(typeDelete).toHaveBeenCalledWith({ where: { id: "type-1" } });
  });

  it("creating a type never writes task activity", async () => {
    await expect(createMarketingIssueTypeAction(WEB, typeForm({ name: "Social post" }))).resolves.toEqual({
      ok: true,
    });
    expect(bugActivityCreateMany).not.toHaveBeenCalled();
  });
});
