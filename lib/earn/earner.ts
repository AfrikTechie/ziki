import { prisma } from "@/lib/prisma";
import { EARN_PROJECT_SLUG, EARN_WORKSPACE_SLUG } from "@/lib/earn/draft";
import { earnTenantId } from "@/lib/earn/progress";

/** The Earn workspace (#earn-drafts): where people who came to earn work, and where their agents live. */
export async function earnWorkspace() {
  return prisma.tenant.findUnique({ where: { slug: EARN_WORKSPACE_SLUG }, select: { id: true, name: true } });
}

/**
 * Someone's Earn agent (#earn-standalone): an agent they own that lives in the Earn workspace. Earn is a place of
 * its own, so the agents they have in their other workspaces are not Earn agents: they don't count as connected,
 * and they are not shown on the earn pages.
 */
export function earnAgentWhere(userId: string) {
  return { ownerUserId: userId, revokedAt: null, tenant: { slug: EARN_WORKSPACE_SLUG } };
}

/** Whether someone is an earner: a member of the Earn workspace. Builders elsewhere don't see Earn. */
export async function isEarner(userId: string): Promise<boolean> {
  const workspace = await earnWorkspace().catch(() => null);
  if (!workspace) return false;
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: workspace.id, userId } },
    select: { id: true },
  });
  return Boolean(membership);
}

/**
 * Joins someone to the Earn workspace as a member (once), making the workspace
 * and its one project first if this is the first time. Their agent works in
 * that project. Returns the workspace and project ids.
 */
export async function joinEarnWorkspace(userId: string): Promise<{ tenantId: string; projectId: string }> {
  const tenantId = await earnTenantId(prisma, EARN_WORKSPACE_SLUG);
  let project = await prisma.project.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!project) {
    try {
      project = await prisma.project.create({ data: { tenantId, slug: EARN_PROJECT_SLUG, name: "Ziki Earn" }, select: { id: true } });
    } catch (error) {
      // Two people arriving at once: the other one made it first.
      project = await prisma.project.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!project) throw error;
    }
  }
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    create: { tenantId, userId, role: "member" },
    update: {},
  });
  return { tenantId, projectId: project.id };
}
