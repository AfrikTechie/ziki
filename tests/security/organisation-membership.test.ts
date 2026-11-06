import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Organisation membership (#425): reports are filed into the reporter's organisation,
 * someone with no membership can't file at all, an area from another project
 * is refused, and an issue in another organisation is "not found".
 */

vi.mock("@/lib/organisation-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisation-context")>()),
  currentOrganisationIdFor: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));
// Tidying an idea with Claude is a network call: as with no API key, it leaves the text as typed.
vi.mock("@/lib/idea-structuring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/idea-structuring")>()),
  structureIdea: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/organisation-access", () => ({
  currentOrganisationAccess: vi.fn(async () => ({
    organisationId: "organisation-zedu",
    organisationName: "Zedu",
    organisationSlug: "zedu",
    membershipRole: "member",
    admin: false,
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bug: { findUnique: vi.fn(), create: vi.fn() },
    idea: { create: vi.fn() },
    // #project-urls: the form names its project; only one in the reporter's organisation is used.
    project: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organisationId: string } }) =>
        where.id === "project-zedu" && where.organisationId === "organisation-zedu" ? { id: "project-zedu", slug: "zedu" } : null),
    },
    projectArea: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { createBugAction, updateBugAction } from "@/app/actions/issues";

const db = prisma as unknown as {
  bug: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  idea: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  projectArea: { findFirst: ReturnType<typeof vi.fn> };
  $executeRaw: ReturnType<typeof vi.fn>;
};
const organisationOf = currentOrganisationIdFor as unknown as ReturnType<typeof vi.fn>;

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const report = form({
  title: "Login button does nothing",
  description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
  proofLinks: "",
  projectId: "project-zedu",
});

describe("issue actions are organisation-scoped (#425)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", role: "user" });
    db.$transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(prisma));
  });

  it("refuses to file a report for someone with no membership", async () => {
    organisationOf.mockResolvedValue(null);
    expect(await createBugAction(report)).toEqual({ error: NO_ORGANISATION_MESSAGE });
    expect(db.idea.create).not.toHaveBeenCalled();
  });

  it("files the report, as an idea, into the reporter's organisation and project", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    db.idea.create.mockRejectedValue(new Error("stop after create"));
    await createBugAction(report).catch(() => undefined);
    expect(db.idea.create).toHaveBeenCalledTimes(1);
    expect(db.idea.create.mock.calls[0][0].data).toMatchObject({
      organisationId: "organisation-zedu",
      projectId: "project-zedu",
      beneficiaryUserId: "user-1",
    });
  });

  it("refuses a project from another organisation", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    const result = await createBugAction(form({
      title: "Login button does nothing",
      description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
      proofLinks: "",
      projectId: "project-acme",
    }));
    expect(result).toEqual({ error: NO_ORGANISATION_MESSAGE });
    expect(db.idea.create).not.toHaveBeenCalled();
  });

  it("rejects an area from another project before saving", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    db.projectArea.findFirst.mockResolvedValue(null);
    const result = await createBugAction(form({
      title: "Login button does nothing",
      description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
      proofLinks: "",
      projectId: "project-zedu",
      areaId: "foreign-area",
    }));
    expect(result).toMatchObject({ error: expect.any(String), field: "areaId" });
    expect(db.idea.create).not.toHaveBeenCalled();
  });

  it("treats an issue in another organisation as not found", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    db.bug.findUnique.mockResolvedValue(null);
    expect(await updateBugAction("bug-in-acme", form({ status: "resolved" }))).toEqual({
      error: expect.any(String),
    });
    expect(db.bug.findUnique.mock.calls[0][0].where).toEqual({ id: "bug-in-acme", organisationId: "organisation-zedu" });
  });
});
