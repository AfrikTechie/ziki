import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  currentOrganisationIdFor: vi.fn(),
  isAdminOfOrganisation: vi.fn(),
  revalidatePath: vi.fn(),
  projectFindFirst: vi.fn(),
  repositoryCount: vi.fn(),
  repositoryFindFirst: vi.fn(),
  repositoryCreate: vi.fn(),
  repositoryDelete: vi.fn(),
  bugCount: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agents/membership", () => ({ isAdminOfOrganisation: mocks.isAdminOfOrganisation }));
vi.mock("@/lib/organisation-context", () => ({ currentOrganisationIdFor: mocks.currentOrganisationIdFor, NO_ORGANISATION_MESSAGE: "Join an organisation." }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    projectRepository: { count: mocks.repositoryCount, findFirst: mocks.repositoryFindFirst },
    bug: { count: mocks.bugCount },
    $transaction: mocks.transaction,
  },
}));

import { addProjectRepositoryAction, removeProjectRepositoryAction } from "./repositories-actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const addForm = (overrides: Record<string, string> = {}) =>
  form({ slug: "web", url: "https://github.com/Acme/API.git", label: "API", branch: "dev", ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "user-1", role: "user" });
  mocks.currentOrganisationIdFor.mockResolvedValue("org-1");
  mocks.isAdminOfOrganisation.mockResolvedValue(true);
  mocks.projectFindFirst.mockResolvedValue({ id: "project-1", slug: "web", repoUrl: "https://github.com/acme/web" });
  mocks.repositoryCount.mockResolvedValue(0);
  mocks.repositoryCreate.mockResolvedValue({ id: "repo-1" });
  mocks.bugCount.mockResolvedValue(0);
  mocks.transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) =>
    work({
      projectRepository: { create: mocks.repositoryCreate, delete: mocks.repositoryDelete },
      projectAuditEvent: { create: mocks.auditCreate },
    }),
  );
});

describe("addProjectRepositoryAction (#2)", () => {
  it("adds another repository, lower-cased and without .git, and audits it", async () => {
    expect(await addProjectRepositoryAction(undefined, addForm())).toEqual({ ok: true });
    expect(mocks.repositoryCreate).toHaveBeenCalledWith({
      data: { projectId: "project-1", url: "https://github.com/acme/api", label: "API", branch: "dev" },
      select: { id: true },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "repository.added", actorUserId: "user-1", projectId: "project-1", organisationId: "org-1" }),
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/projects/web/settings");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("keeps the label and branch optional", async () => {
    expect(await addProjectRepositoryAction(undefined, addForm({ label: "", branch: "" }))).toEqual({ ok: true });
    expect(mocks.repositoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ label: null, branch: null }),
    }));
  });

  it.each([
    ["a URL that isn't a GitHub repository", { url: "https://gitlab.com/acme/api" }],
    ["a GitHub URL with more than owner/repo", { url: "https://github.com/acme/api/tree/main" }],
    ["a branch with ..", { branch: "dev/../main" }],
  ])("rejects %s", async (_name, overrides) => {
    const result = await addProjectRepositoryAction(undefined, addForm(overrides));
    expect(result).toMatchObject({ ok: false });
    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it("refuses the project's main repository", async () => {
    const result = await addProjectRepositoryAction(undefined, addForm({ url: "https://github.com/ACME/web" }));
    expect(result).toEqual({ ok: false, error: "That is already the project's main repository." });
    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it("refuses an eleventh repository", async () => {
    mocks.repositoryCount.mockResolvedValue(10);
    expect(await addProjectRepositoryAction(undefined, addForm())).toMatchObject({ ok: false });
    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it("says when the repository is already listed", async () => {
    mocks.repositoryCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }));
    expect(await addProjectRepositoryAction(undefined, addForm())).toEqual({ ok: false, error: "That repository is already listed." });
  });

  it("only lets organisation owners and admins add one", async () => {
    mocks.isAdminOfOrganisation.mockResolvedValue(false);
    expect(await addProjectRepositoryAction(undefined, addForm())).toMatchObject({ ok: false });
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
  });
});

describe("removeProjectRepositoryAction (#2)", () => {
  beforeEach(() => {
    mocks.repositoryFindFirst.mockResolvedValue({ id: "repo-1", url: "https://github.com/acme/api", label: "API", branch: null });
  });

  it("removes a repository no open issue depends on, and audits it", async () => {
    expect(await removeProjectRepositoryAction("web", "repo-1")).toEqual({ ok: true });
    expect(mocks.bugCount).toHaveBeenCalledWith({ where: expect.objectContaining({
      projectId: "project-1",
      status: { notIn: ["resolved", "closed"] },
      pullRequestUrl: { startsWith: "https://github.com/acme/api/pull/", mode: "insensitive" },
    }) });
    expect(mocks.repositoryDelete).toHaveBeenCalledWith({ where: { id: "repo-1" } });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "repository.removed" }),
    }));
  });

  it("keeps a repository while an open issue links a pull request in it", async () => {
    mocks.bugCount.mockResolvedValue(2);
    const result = await removeProjectRepositoryAction("web", "repo-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("2 open issues") });
    expect(mocks.repositoryDelete).not.toHaveBeenCalled();
  });

  it("only removes a repository of this project", async () => {
    mocks.repositoryFindFirst.mockResolvedValue(null);
    expect(await removeProjectRepositoryAction("web", "repo-elsewhere")).toEqual({ ok: false, error: "That repository is no longer listed." });
    expect(mocks.repositoryFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "repo-elsewhere", projectId: "project-1" } }));
    expect(mocks.repositoryDelete).not.toHaveBeenCalled();
  });
});
