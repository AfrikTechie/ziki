import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Organisation membership (#425): reports are filed into the reporter's organisation,
 * someone with no membership can't file at all, an area from another project
 * is refused, and an issue in another organisation is "not found".
 */

const membershipFindUnique = vi.hoisted(() => vi.fn());
const membershipFindFirst = vi.hoisted(() => vi.fn());
const projectMembershipFindUnique = vi.hoisted(() => vi.fn());
const projectMembershipFindFirst = vi.hoisted(() => vi.fn());
const bugFindUnique = vi.hoisted(() => vi.fn());
const bugCreate = vi.hoisted(() => vi.fn());
const ideaCreate = vi.hoisted(() => vi.fn());
const projectFindFirst = vi.hoisted(() => vi.fn());
const projectAreaFindFirst = vi.hoisted(() => vi.fn());
const issueWatchUpsert = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "iw-1" }));
const userFindUnique = vi.hoisted(() => vi.fn());
const userFindFirst = vi.hoisted(() => vi.fn());
const userFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const $transaction = vi.hoisted(() => vi.fn());
const $executeRaw = vi.hoisted(() => vi.fn());

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
    organisationId: "own-organisation-id",
    organisationName: "Own Organisation",
    organisationSlug: "own",
    membershipRole: "owner" as const,
    admin: true,
  })),
  organisationAccessFor: vi.fn(async () => ({
    organisationId: "target-org-id",
    organisationName: "Target Organisation",
    organisationSlug: "target",
    membershipRole: null,
    admin: false,
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bug: { findUnique: bugFindUnique, create: bugCreate },
    idea: { create: ideaCreate },
    project: { findFirst: projectFindFirst },
    projectArea: { findFirst: projectAreaFindFirst },
    membership: {
      findFirst: membershipFindFirst,
      findUnique: membershipFindUnique,
    },
    projectMembership: { findUnique: projectMembershipFindUnique, findFirst: projectMembershipFindFirst },
    issueWatch: { upsert: issueWatchUpsert, updateMany: vi.fn(), createMany: vi.fn() },
    user: { findUnique: userFindUnique, findFirst: userFindFirst, findMany: userFindMany },
    $transaction,
    $executeRaw,
  },
}));

import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { canContributeToProject } from "@/lib/project-permissions";
import { createBugAction, updateBugAction } from "@/app/actions/issues";
import { setWatchingAction } from "@/app/actions/watch";

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
    $transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run({
      idea: { create: ideaCreate },
      projectArea: { findFirst: projectAreaFindFirst },
      $executeRaw,
    }));
    projectFindFirst.mockImplementation(async ({ where }: { where: { id: string; organisationId?: string } }) =>
      where.id === "project-zedu" ? { id: "project-zedu", slug: "zedu", organisationId: "organisation-zedu" } : null
    );
    membershipFindUnique.mockImplementation(async ({ where }: { where?: { organisationId_userId?: { organisationId: string; userId: string } } }) =>
      where?.organisationId_userId?.organisationId === "organisation-zedu" && where?.organisationId_userId?.userId !== "stranger-1" ? { id: "m-1" } : null
    );
    membershipFindFirst.mockResolvedValue(null);
    projectMembershipFindUnique.mockResolvedValue(null);
    projectMembershipFindFirst.mockResolvedValue(null);
  });

  it("refuses to file a report for someone with no membership", async () => {
    organisationOf.mockResolvedValue(null);
    expect(await createBugAction(report)).toEqual({ error: NO_ORGANISATION_MESSAGE });
    expect(ideaCreate).not.toHaveBeenCalled();
  });

  it("files the report, as an idea, into the reporter's organisation and project", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    ideaCreate.mockRejectedValue(new Error("stop after create"));
    await createBugAction(report).catch(() => undefined);
    expect(ideaCreate).toHaveBeenCalledTimes(1);
    expect(ideaCreate.mock.calls[0][0].data).toMatchObject({
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
    expect(ideaCreate).not.toHaveBeenCalled();
  });

  it("rejects an area from another project before saving", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    projectAreaFindFirst.mockResolvedValue(null);
    projectFindFirst.mockResolvedValue({ id: "project-zedu", slug: "zedu", organisationId: "organisation-zedu" });
    const result = await createBugAction(form({
      title: "Login button does nothing",
      description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
      proofLinks: "",
      projectId: "project-zedu",
      areaId: "foreign-area",
    }));
    expect(result).toMatchObject({ error: expect.any(String), field: "areaId" });
    expect(ideaCreate).not.toHaveBeenCalled();
  });

  it("treats an issue in another organisation as not found", async () => {
    organisationOf.mockResolvedValue("organisation-zedu");
    bugFindUnique.mockResolvedValue(null);
    expect(await updateBugAction("bug-in-acme", form({ status: "resolved" }))).toEqual({
      error: expect.any(String),
    });
    expect(bugFindUnique.mock.calls[0][0].where).toEqual({ id: "bug-in-acme", organisationId: "organisation-zedu" });
  });

  it("allows direct project members to watch issues and refuses non-members", async () => {
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "external-1", role: "user" });
    bugFindUnique.mockResolvedValue({
      id: "bug-1",
      organisationId: "organisation-zedu",
      projectId: "project-zedu",
      isDeleted: false,
      project: { visibility: "private" },
    });
    projectMembershipFindFirst.mockResolvedValue({ id: "pm-1" });
    membershipFindFirst.mockResolvedValue(null);

    const watchRes = await setWatchingAction("bug-1", true);
    expect(watchRes).toEqual({ ok: true });
    expect(issueWatchUpsert).toHaveBeenCalled();

    // Now test refusal for non-member
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "stranger-1", role: "user" });
    projectMembershipFindFirst.mockResolvedValue(null);
    membershipFindFirst.mockResolvedValue(null);

    const refuseRes = await setWatchingAction("bug-1", true);
    expect(refuseRes).toEqual({ error: "Issue not found" });
  });
});

describe("canContributeToProject permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows super_admin regardless of membership", async () => {
    const allowed = await canContributeToProject({ id: "admin-1", role: "super_admin" }, "p-1", "t-1");
    expect(allowed).toBe(true);
  });

  it("allows direct project members", async () => {
    projectMembershipFindUnique.mockResolvedValue({ id: "pm-1" });
    const allowed = await canContributeToProject({ id: "user-1", role: "user" }, "p-1", "t-1");
    expect(allowed).toBe(true);
  });

  it("allows organisation members", async () => {
    projectMembershipFindUnique.mockResolvedValue(null);
    membershipFindUnique.mockResolvedValue({ id: "m-1" });
    const allowed = await canContributeToProject({ id: "user-1", role: "user" }, "p-1", "t-1");
    expect(allowed).toBe(true);
  });

  it("denies uninvited non-members", async () => {
    projectMembershipFindUnique.mockResolvedValue(null);
    membershipFindUnique.mockResolvedValue(null);
    const allowed = await canContributeToProject({ id: "stranger-1", role: "user" }, "p-1", "t-1");
    expect(allowed).toBe(false);
  });
});
