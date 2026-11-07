import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { activeIn } from "@/lib/agents/active-in";
import { parseDismissed } from "@/lib/onboarding";
import { organisationAccessFor } from "@/lib/organisation-access";
import { NEXT_STEP_COOKIE, organisationNextStep, type OrganisationNextStep } from "@/lib/organisation-next-step";
import type { ProjectRef } from "@/lib/project-paths";
import type { AppRole } from "@/lib/roles";

/**
 * The next-step card (lib/organisation-next-step.ts) for a page other than the
 * Ideas list, which loads its own: the Marketing tab (#earnings), so someone who
 * joins a marketing project is asked to connect an agent there too. Same rules,
 * same card. Null when there is nothing to show or it couldn't be loaded.
 */
export async function loadOrganisationNextStep(input: {
  userId: string;
  appRole: AppRole | null | undefined;
  organisationId: string;
  slug: ProjectRef;
}): Promise<OrganisationNextStep | null> {
  const { userId, appRole, organisationId, slug } = input;
  try {
    const { membershipRole } = await organisationAccessFor(userId, organisationId, appRole);
    if (!membershipRole) return null;
    const dismissed = parseDismissed((await cookies()).get(NEXT_STEP_COOKIE)?.value).includes(organisationId);
    if (dismissed) return null;
    const now = new Date();
    const [agentCount, memberCount, pendingInvites] = await Promise.all([
      prisma.agent.count({ where: { ...activeIn(organisationId), ownerUserId: userId, revokedAt: null } }),
      prisma.membership.count({ where: { organisationId } }),
      prisma.organisationInvite.count({ where: { organisationId, acceptedAt: null, expiresAt: { gt: now } } }),
    ]);
    // Agents that exist but aren't set up yet only matter once there are agents, and then the card is never shown.
    return organisationNextStep({ slug, membershipRole, appRole, agentCount, blockedAgentCount: 0, memberCount, pendingInvites, dismissed });
  } catch (error) {
    console.error("[organisation-next-step] load failed", error);
    return null;
  }
}
