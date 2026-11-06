import { isSuperAdmin, type AppRole } from "@/lib/roles";

/** A person's role inside one organisation. Matches Prisma `MembershipRole`. */
export type OrganisationRole = "owner" | "admin" | "member";

/**
 * Admin powers inside one organisation.
 *
 * An owner or admin of that organisation has them. The site's super admin
 * does too. A site-wide `admin` does not: that title must not follow someone
 * into an organisation where they are only a member.
 */
export function isOrganisationAdmin(
  membershipRole: OrganisationRole | null | undefined,
  appRole?: AppRole | null,
): boolean {
  return membershipRole === "owner" || membershipRole === "admin" || isSuperAdmin(appRole);
}

/**
 * Owner powers inside one organisation.
 *
 * An owner of that organisation has them. The site's super admin
 * does too across all organisations.
 */
export function isOrganisationOwner(
  membershipRole: OrganisationRole | null | undefined,
  appRole?: AppRole | null,
): boolean {
  return membershipRole === "owner" || isSuperAdmin(appRole);
}
