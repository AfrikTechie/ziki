import { prisma } from "@/lib/prisma";
import { isSuperAdmin, type AppRole } from "@/lib/roles";
import { isAdminOfOrganisation } from "@/lib/agents/membership";

export type UserIdentifier = {
  id: string;
  role?: AppRole | null;
};

/**
 * Checks whether a user can contribute to a project (report issues, comment, bid, claim).
 * Allowed if:
 * 1. User is a site super_admin.
 * 2. User is an organisation owner, admin, or member of the project's organisation.
 * 3. User is an accepted project member (ProjectMembership).
 */
export async function canContributeToProject(
  user: UserIdentifier,
  projectId: string,
  organisationId?: string,
): Promise<boolean> {
  if (isSuperAdmin(user.role)) return true;

  // Check direct ProjectMembership
  const projectMember = await prisma.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    select: { id: true },
  });
  if (projectMember) return true;

  // Resolve organisationId if not provided
  let resolvedOrganisationId = organisationId;
  if (!resolvedOrganisationId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { organisationId: true },
    });
    resolvedOrganisationId = project?.organisationId;
  }
  if (!resolvedOrganisationId) return false;

  // Check Organisation Membership
  const orgMember = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId: resolvedOrganisationId, userId: user.id } },
    select: { id: true },
  });
  return Boolean(orgMember);
}

/**
 * Checks whether a user can manage a project's settings and join requests.
 * Handled by the organisation's owners and admins (and site super admins).
 */
export async function canManageProject(
  user: UserIdentifier,
  organisationId: string,
): Promise<boolean> {
  return isAdminOfOrganisation(user, organisationId);
}
