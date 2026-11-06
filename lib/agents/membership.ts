import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOrganisationAdmin } from "@/lib/organisation-role";
import { ZEDU_SLUG } from "@/lib/organisation";
import { isSuperAdmin, type AppRole } from "@/lib/roles";

/**
 * Which organisation a person's agents live in, and who administers it (#427).
 *
 * Until issues are scoped to the session's organisation (#425), a person's agents go
 * in the organisation they belong to, preferring Zedu. Someone with no membership
 * (a signup after the platform migration, #423) can't register agents until
 * they create or join a organisation (#444).
 */

export type OwnerOrganisation = { organisationId: string; role: MembershipRole };

export async function organisationForOwner(userId: string): Promise<OwnerOrganisation | null> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { organisationId: true, role: true, organisation: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  const chosen = memberships.find((m) => m.organisation.slug === ZEDU_SLUG) ?? memberships[0];
  return chosen ? { organisationId: chosen.organisationId, role: chosen.role } : null;
}

/** Owners and admins of a organisation. The site's super admin counts everywhere. */
export function isOrganisationAdminRole(
  membershipRole: MembershipRole | null | undefined,
  appRole?: AppRole | null,
): boolean {
  return isOrganisationAdmin(membershipRole, appRole);
}

export async function isAdminOfOrganisation(
  user: { id: string; role?: AppRole | null },
  organisationId: string,
): Promise<boolean> {
  if (isSuperAdmin(user.role)) return true;
  const membership = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId, userId: user.id } },
    select: { role: true },
  });
  return isOrganisationAdminRole(membership?.role);
}
