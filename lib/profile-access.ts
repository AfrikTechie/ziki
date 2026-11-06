import type { Prisma, PrismaClient } from "@prisma/client";
import { isOrganisationAdminRole } from "@/lib/agents/membership";
import { isSuperAdmin, type AppRole } from "@/lib/roles";

type Db = Pick<PrismaClient, "membership"> | Pick<Prisma.TransactionClient, "membership">;

/**
 * Whether `viewer` may open `personId`'s profile (#503).
 *
 * A profile shows someone's name, site role, join date, points and issues,
 * so it is visible to people who share at least one organisation with them, to
 * the person themselves and to the site's super admin. Everyone else gets
 * a 404, the same as an id that doesn't exist, so the page can't be used to
 * check whether an account exists.
 */
export async function canViewProfile(
  db: Db,
  viewer: { id: string; role?: AppRole | null },
  personId: string,
): Promise<boolean> {
  if (viewer.id === personId) return true;
  if (isSuperAdmin(viewer.role)) return true;
  const shared = await db.membership.findFirst({
    where: { userId: personId, organisation: { memberships: { some: { userId: viewer.id } } } },
    select: { id: true },
  });
  return shared !== null;
}

/**
 * Whether `viewer` may see `personId`'s wallet address (#618).
 *
 * The address is set by the person alone and only becomes useful to a
 * transfer, so it goes to them and to admins of a organisation they share — not to
 * everyone who can see the profile's name, points and issues. The site's
 * super admin counts as an admin everywhere; a site-wide `admin` does not.
 */
export async function canViewWallet(
  db: Db,
  viewer: { id: string; role?: AppRole | null },
  personId: string,
  organisationId: string | null,
): Promise<boolean> {
  if (viewer.id === personId) return true;
  if (!organisationId) return false;
  const membership = await db.membership.findUnique({
    where: { organisationId_userId: { organisationId, userId: viewer.id } },
    select: { role: true },
  });
  return isOrganisationAdminRole(membership?.role, viewer.role);
}
