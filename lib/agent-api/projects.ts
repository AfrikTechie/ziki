import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site-url";
import { projectPath, projectRef } from "@/lib/project-paths";
import { IssueApiError } from "@/lib/agent-api/errors";
import {
  getPlatformRewardConfig,
  projectDefaultsFromPlatform,
} from "@/lib/points/platform-rewards";
import { parseProjectRewardConfig } from "@/lib/points/project-rewards";
import { workflowValues } from "@/lib/workflow-config";
import type { Prisma } from "@prisma/client";

/**
 * Project discovery (#607): no issue route can be called without a
 * `projectId`, and until now nothing told an agent which projects exist or
 * what each is for. `Project.goal`, `repoUrl` and `stagingUrl` are the lead's
 * brief; each project's workflow numbers expose the gates it enforces so an
 * agent can set expectations.
 *
 * `githubInstallationId` is deliberately not selected — it is deployment
 * configuration, not agent-visible data.
 */
const projectSelect = {
  id: true, slug: true, name: true, goal: true, repoUrl: true, stagingUrl: true, rewardConfig: true,
  workflow: true,
} satisfies Prisma.ProjectSelect;

/** The organisation's slug, the first segment of its projects' addresses (#project-urls). */
export async function tenantSlugOf(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  if (!tenant) throw new IssueApiError(404, "Organisation not found.");
  return tenant.slug;
}

export async function listAgentProjectSummaries(tenantId: string) {
  return prisma.project.findMany({
    where: { tenantId },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, name: true },
  });
}

/** Every project in the agent's tenant, with each project's goal and open-issue count. */
export async function listAgentProjects(tenantId: string) {
  const [projects, platform] = await Promise.all([
    prisma.project.findMany({
      where: { tenantId },
      orderBy: { slug: "asc" },
      select: projectSelect,
    }),
    getPlatformRewardConfig(prisma),
  ]);
  const orgSlug = await tenantSlugOf(tenantId);
  const base = projectDefaultsFromPlatform(platform);
  const openCounts = await prisma.bug.groupBy({
    by: ["projectId"],
    where: { tenantId, projectId: { in: projects.map((project) => project.id) }, isDeleted: false, substatus: "open" },
    _count: { _all: true },
  });
  const openByProject = new Map(openCounts.map((row) => [row.projectId, row._count._all]));
  return projects.map((project) => ({
    ...project,
    workUrl: absoluteUrl(projectPath(projectRef(orgSlug, project.slug), "/work")),
    notesUrl: `/api/v1/projects/${project.id}/notes`,
    notesCommentsUrl: `/api/v1/projects/${project.id}/notes/comments`,
    rewardRules: parseProjectRewardConfig(project.rewardConfig, base),
    workflow: workflowValues(project.workflow),
    openIssueCount: openByProject.get(project.id) ?? 0,
  }));
}

/** One project in the agent's tenant; foreign project ids are a 404, not a leak. */
export async function getAgentProject(tenantId: string, projectId: string) {
  const [project, platform] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, tenantId },
      select: projectSelect,
    }),
    getPlatformRewardConfig(prisma),
  ]);
  if (!project) throw new IssueApiError(404, "Project not found.");
  const orgSlug = await tenantSlugOf(tenantId);
  const openIssueCount = await prisma.bug.count({
    where: { tenantId, projectId: project.id, isDeleted: false, substatus: "open" },
  });
  return {
    ...project,
    workUrl: absoluteUrl(projectPath(projectRef(orgSlug, project.slug), "/work")),
    notesUrl: `/api/v1/projects/${project.id}/notes`,
    notesCommentsUrl: `/api/v1/projects/${project.id}/notes/comments`,
    rewardRules: parseProjectRewardConfig(project.rewardConfig, projectDefaultsFromPlatform(platform)),
    workflow: workflowValues(project.workflow),
    openIssueCount,
  };
}
