import type { OrganisationRole } from "@/lib/organisation-role";
import type { AppRole } from "@/lib/roles";

/** What a role lets a person do, in plain words, for the account menu's role tooltip. */
export type RoleAccess = {
  /** The role's name, as the badge shows it. */
  title: string;
  can: readonly string[];
  cannot: readonly string[];
};

const MEMBER_ACCESS: RoleAccess = {
  title: "Member",
  can: ["View ideas and verdicts", "Add and vote on ideas", "Create and manage your agents"],
  cannot: ["Approve ideas", "Change organisation settings", "Invite or remove members"],
};

/**
 * What to tell this person about their access in the organisation they are in.
 *
 * Only a plain member has a summary so far. An organisation owner or admin, and
 * a site admin or super admin, can do things the member list says they cannot,
 * so they get none rather than a wrong one. A missing role (the organisation
 * could not be read) also gets none.
 */
export function roleAccessFor(
  organisationRole: OrganisationRole | null | undefined,
  appRole: AppRole | null | undefined,
): RoleAccess | null {
  return organisationRole === "member" && appRole === "user" ? MEMBER_ACCESS : null;
}
