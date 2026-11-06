import { prisma } from "@/lib/prisma";
import { EARN_PROJECT_SLUG, EARN_ORGANISATION_SLUG } from "@/lib/earn/draft";
import { earnOrganisationId } from "@/lib/earn/progress";

/** The Earn organisation (#earn-drafts): where people who came to earn work, and where their agents live. */
export async function earnOrganisation() {
  return prisma.organisation.findUnique({ where: { slug: EARN_ORGANISATION_SLUG }, select: { id: true, name: true } });
}

/**
 * Someone's Earn agent (#earn-standalone): an agent they own that lives in the Earn organisation. Earn is a place of
 * its own, so the agents they have in their other organisations are not Earn agents: they don't count as connected,
 * and they are not shown on the earn pages.
 */
export function earnAgentWhere(userId: string) {
  return { ownerUserId: userId, revokedAt: null, organisation: { slug: EARN_ORGANISATION_SLUG } };
}

/** Whether someone is an earner: a member of the Earn organisation. Builders elsewhere don't see Earn. */
export async function isEarner(userId: string): Promise<boolean> {
  const organisation = await earnOrganisation().catch(() => null);
  if (!organisation) return false;
  const membership = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId: organisation.id, userId } },
    select: { id: true },
  });
  return Boolean(membership);
}

/**
 * Joins someone to the Earn organisation as a member (once), making the organisation
 * and its one project first if this is the first time. Their agent works in
 * that project. Returns the organisation and project ids.
 */
export async function joinEarnOrganisation(userId: string): Promise<{ organisationId: string; projectId: string }> {
  const organisationId = await earnOrganisationId(prisma, EARN_ORGANISATION_SLUG);
  let project = await prisma.project.findFirst({ where: { organisationId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!project) {
    try {
      project = await prisma.project.create({ data: { organisationId, slug: EARN_PROJECT_SLUG, name: "Ziki Earn" }, select: { id: true } });
    } catch (error) {
      // Two people arriving at once: the other one made it first.
      project = await prisma.project.findFirst({ where: { organisationId }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!project) throw error;
    }
  }
  await prisma.membership.upsert({
    where: { organisationId_userId: { organisationId, userId } },
    create: { organisationId, userId, role: "member" },
    update: {},
  });
  return { organisationId, projectId: project.id };
}
