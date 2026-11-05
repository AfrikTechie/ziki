import { cache } from "react";
import { requireUser } from "@/lib/auth-helpers";
import {
  isOrganizationAdmin,
  isOrganizationOwner,
  type OrganizationRole,
} from "@/lib/organization-role";
import { currentTenantAccess } from "@/lib/tenant-access";

/** The organization this device is working in, as /org shows it. */
export type OrgContext = {
  id: string;
  name: string;
  slug: string;
  /** The viewer's role in it. The site super admin counts as an owner. */
  role: OrganizationRole;
  /** Owners, admins and the site super admin change things; everyone else reads. */
  admin: boolean;
  /** Owners and the site super admin change roles and the organization itself. */
  owner: boolean;
};

/**
 * The signed-in person and their current organization, once per request.
 * Any member may open /org; `org` is null when they have no organization.
 */
export const loadOrg = cache(async () => {
  const user = await requireUser();
  const access = await currentTenantAccess(user.id, user.role);
  if (!access.tenantId || !access.tenantName || !access.tenantSlug || !access.membershipRole) {
    return { user, org: null };
  }
  const org: OrgContext = {
    id: access.tenantId,
    name: access.tenantName,
    slug: access.tenantSlug,
    role: access.membershipRole,
    admin: isOrganizationAdmin(access.membershipRole, user.role),
    owner: isOrganizationOwner(access.membershipRole, user.role),
  };
  return { user, org };
});
