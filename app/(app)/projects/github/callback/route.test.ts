import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireUser = vi.hoisted(() => vi.fn());
const currentOrganisationIdFor = vi.hoisted(() => vi.fn());
const isAdminOfOrganisation = vi.hoisted(() => vi.fn());
const cookieGet = vi.hoisted(() => vi.fn());
const cookieDelete = vi.hoisted(() => vi.fn());
const projectFindFirst = vi.hoisted(() => vi.fn());
const repositoryFindFirst = vi.hoisted(() => vi.fn());
const repositoryUpdate = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet, delete: cookieDelete }) }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser }));
vi.mock("@/lib/organisation-context", () => ({ currentOrganisationIdFor }));
vi.mock("@/lib/agents/membership", () => ({ isAdminOfOrganisation }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: projectFindFirst },
    projectRepository: { findFirst: repositoryFindFirst },
    $transaction: transaction,
  },
}));

import { GET } from "./route";

const callback = (query: string) => new NextRequest(`http://localhost/projects/github/callback?${query}`);
const REPO_STATE = "web.repo-cmrepo0000000001.random-state";
const listedRepository = { id: "cmrepo0000000001", url: "https://github.com/partner/api", githubInstallationId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("NEXTAUTH_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  requireUser.mockResolvedValue({ id: "user-1", role: "user" });
  currentOrganisationIdFor.mockResolvedValue("org-1");
  isAdminOfOrganisation.mockResolvedValue(true);
  cookieGet.mockReturnValue({ value: "web.random-state" });
  projectFindFirst.mockResolvedValue({ id: "project-1", githubInstallationId: null });
  transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) =>
    work({ project: { update }, projectRepository: { update: repositoryUpdate }, projectAuditEvent: { create: audit } }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GitHub App project callback", () => {
  it("rejects a mismatched one-time state before writing", async () => {
    const response = await GET(callback("installation_id=123&state=forged&setup_action=install"));
    expect(response.headers.get("location")).toContain("github=error");
    expect(requireUser).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("saves and audits the project's installation for an organisation admin", async () => {
    const response = await GET(callback("installation_id=12345&state=web.random-state&setup_action=install"));
    expect(response.headers.get("location")).toContain("/projects/web/settings?github=connected");
    expect(projectFindFirst).toHaveBeenCalledWith({ where: { organisationId: "org-1", slug: "web" }, select: { id: true, githubInstallationId: true } });
    expect(update).toHaveBeenCalledWith({ where: { id: "project-1" }, data: { githubInstallationId: "12345" } });
    expect(repositoryUpdate).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organisationId: "org-1", actorUserId: "user-1", action: "github.installation.connected" }) }));
  });

  it("does not connect an installation for someone who is not an admin", async () => {
    isAdminOfOrganisation.mockResolvedValue(false);
    const response = await GET(callback("installation_id=12345&state=web.random-state&setup_action=install"));
    expect(response.headers.get("location")).toBe("http://localhost/home");
    expect(projectFindFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("GitHub App callback for one of the project's other repositories (#2)", () => {
  it("saves the installation on that repository, not the project, when the state names it", async () => {
    cookieGet.mockReturnValue({ value: REPO_STATE });
    repositoryFindFirst.mockResolvedValue(listedRepository);
    const response = await GET(callback(`installation_id=777&state=${REPO_STATE}&setup_action=install`));
    expect(response.headers.get("location")).toContain("/projects/web/settings?github=connected");
    expect(repositoryFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cmrepo0000000001", projectId: "project-1" } }));
    expect(repositoryUpdate).toHaveBeenCalledWith({ where: { id: "cmrepo0000000001" }, data: { githubInstallationId: "777" } });
    expect(update).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organisationId: "org-1", action: "github.installation.connected" }) }));
  });

  it("reads the repository from the returned state when the cookie is gone", async () => {
    cookieGet.mockReturnValue(undefined);
    repositoryFindFirst.mockResolvedValue(listedRepository);
    const response = await GET(callback(`installation_id=777&state=${REPO_STATE}&setup_action=install`));
    expect(response.headers.get("location")).toContain("/projects/web/settings?github=connected");
    expect(repositoryUpdate).toHaveBeenCalledWith({ where: { id: "cmrepo0000000001" }, data: { githubInstallationId: "777" } });
    expect(update).not.toHaveBeenCalled();
  });

  it("writes nothing when the named repository is not the project's", async () => {
    const state = "web.repo-cmrepo0000000009.random-state";
    cookieGet.mockReturnValue({ value: state });
    repositoryFindFirst.mockResolvedValue(null);
    const response = await GET(callback(`installation_id=777&state=${state}&setup_action=install`));
    expect(response.headers.get("location")).toContain("github=error");
    expect(transaction).not.toHaveBeenCalled();
  });
});
