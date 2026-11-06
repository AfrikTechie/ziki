import { cache } from "react";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOrganisationAdmin, type OrganisationRole } from "@/lib/organisation-role";
import { isSuperAdmin, type AppRole } from "@/lib/roles";
import { currentOrganisationIdFor } from "@/lib/organisation-context";

/**
 * Whether the signed-in person may administer one organisation.
 *
 * The answer comes from their membership in that organisation. The site-wide
 * admin role is not consulted, except for the site super admin, who can
 * administer every organisation and acts as owner.
 */

export type OrganisationAccess = {
  organisationId: string | null;
  organisationName: string | null;
  organisationSlug: string | null;
  membershipRole: OrganisationRole | null;
  admin: boolean;
};

function accessFrom(
  organisationId: string | null,
  membership: { role: MembershipRole; organisation: { name: string; slug: string } } | null,
  appRole: AppRole | null | undefined,
): OrganisationAccess {
  const isSuper = isSuperAdmin(appRole);
  return {
    organisationId,
    organisationName: membership?.organisation.name ?? null,
    organisationSlug: membership?.organisation.slug ?? null,
    membershipRole: !organisationId ? null : isSuper ? "owner" : (membership?.role ?? null),
    admin: isSuper || isOrganisationAdmin(membership?.role, appRole),
  };
}

/** Membership in a known organisation. */
export const organisationAccessFor = cache(async (
  userId: string,
  organisationId: string | null,
  appRole: AppRole | null | undefined,
): Promise<OrganisationAccess> => {
  if (!userId || !organisationId) return accessFrom(organisationId, null, appRole);
  try {
    const membership = await prisma.membership.findUnique({
      where: { organisationId_userId: { organisationId, userId } },
      select: { role: true, organisation: { select: { name: true, slug: true } } },
    });
    return accessFrom(organisationId, membership, appRole);
  } catch (error) {
    console.error("[organisation-access] organisationAccessFor failed", error);
    return accessFrom(organisationId, null, appRole);
  }
});

/** Membership in the organisation this device is working in. */
export const currentOrganisationAccess = cache(async (
  userId: string,
  appRole: AppRole | null | undefined,
): Promise<OrganisationAccess> => {
  const organisationId = await currentOrganisationIdFor(userId);
  return organisationAccessFor(userId, organisationId, appRole);
});
