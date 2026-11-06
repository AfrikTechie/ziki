import type { MembershipRole } from "@prisma/client";
import { isOrganisationAdmin } from "@/lib/organisation-role";
import type { AppRole } from "@/lib/roles";

/** Upvotes an issue needed to be ready, before ideas took verdicts. Kept for issue votes only. */
export const WORK_READINESS_VOTE_THRESHOLD = 3;

export const TICKET_ASSIGN_ERRORS = {
  unauthorized: "Only an owner or admin of this organisation can assign issues to other people",
  unauthorizedUpdate: "Only the assignee, or an owner or admin of this organisation, can update this issue",
  statusNeedsAssignment: "Assign this issue to yourself first, then change its status.",
  needsAgentClaim: "An agent has to be offered this issue, or have its bid awarded, before you can work on it.",
  invalidId: "Invalid issue ID",
  notFound: "Issue not found",
  assigneeNotFound: "Assignee not found",
  failed: "Could not update issue assignment. Please try again.",
} as const;

export type TicketAssignError = keyof typeof TICKET_ASSIGN_ERRORS;

/**
 * Checks whether an actor can assign an issue to a given target assignee.
 * - Owners, admins, and the site super admin can assign to any user, or unassign (targetAssigneeId = null).
 *   A site-wide admin who is only a member cannot.
 * - Normal users cannot take an unassigned issue. That happens when an agent
 *   accepts an offer, such as a bid a manager agent awarded (`claimed`).
 * - Normal users can keep a ticket already assigned to them, and can unassign
 *   themselves (targetAssigneeId = null && currentAssigneeId = actorId).
 * - Normal users cannot assign to any other user or take over another user's assignment.
 */
export function canAssignTicket({
  actorId,
  actorRole,
  membershipRole,
  currentAssigneeId,
  targetAssigneeId,
  claimed = false,
}: {
  actorId: string;
  actorRole?: AppRole | null;
  membershipRole?: MembershipRole | null;
  currentAssigneeId?: string | null;
  targetAssigneeId?: string | null;
  /** True only when this assignment is an accepted offer or an awarded bid. */
  claimed?: boolean;
}): boolean {
  if (isOrganisationAdmin(membershipRole, actorRole)) {
    return true;
  }

  // Keeping an issue you already have. Taking an unassigned one is the claim.
  if (targetAssigneeId === actorId) {
    if (!currentAssigneeId) return claimed;
    return currentAssigneeId === actorId;
  }

  // Self-unassigning (clearing assignment if currently assigned to actor)
  if (!targetAssigneeId && currentAssigneeId === actorId) {
    return true;
  }

  return false;
}
