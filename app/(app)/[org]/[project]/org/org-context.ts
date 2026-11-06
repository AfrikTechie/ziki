import { cache } from "react";
import { requireUser } from "@/lib/auth-helpers";
import {
  isOrganisationAdmin,
  isOrganisationOwner,
  type OrganisationRole,
} from "@/lib/organisation-role";
import { currentOrganisationAccess } from "@/lib/organisation-access";

/** The organisation this device is working in, as /org shows it. */
export type OrgContext = {
  id: string;
  name: string;
  slug: string;
  /** The viewer's role in it. The site super admin counts as an owner. */
  role: OrganisationRole;
  /** Owners, admins and the site super admin change things; everyone else reads. */
  admin: boolean;
  /** Owners and the site super admin change roles and the organisation itself. */
  owner: boolean;
};

/**
 * The signed-in person and their current organisation, once per request.
 * Any member may open /org; `org` is null when they have no organisation.
 */
export const loadOrg = cache(async () => {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId || !access.organisationName || !access.organisationSlug || !access.membershipRole) {
    return { user, org: null };
  }
  const org: OrgContext = {
    id: access.organisationId,
    name: access.organisationName,
    slug: access.organisationSlug,
    role: access.membershipRole,
    admin: isOrganisationAdmin(access.membershipRole, user.role),
    owner: isOrganisationOwner(access.membershipRole, user.role),
  };
  return { user, org };
});
