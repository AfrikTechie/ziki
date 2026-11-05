import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findFirst } } }));

import { AgentProjectError } from "@/lib/agents/require-agent";
import { issueProject } from "@/lib/agent-api/issues";

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
