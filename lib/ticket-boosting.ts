import type { MembershipRole } from "@prisma/client";
import { isOrganisationAdmin } from "@/lib/organisation-role";
import type { AppRole } from "@/lib/roles";

export const TICKET_BOOST_ERRORS = {
  unauthorized: "Only an owner or admin of this organisation can boost issues",
  invalidId: "Invalid issue ID",
  notFound: "Issue not found",
  failed: "Could not update issue boost status. Please try again.",
} as const;

export type TicketBoostError = keyof typeof TICKET_BOOST_ERRORS;

/** Boosting is an organisation power, not a site-wide admin power. */
export function canBoostTicket(
  role?: AppRole | null,
  membershipRole?: MembershipRole | null,
): boolean {
  return isOrganisationAdmin(membershipRole, role);
}

/** Statuses that mean the work is done, so a boost no longer applies. */
const FINISHED_STATUSES: readonly string[] = ["resolved", "closed"];

/**
 * Whether a status change should clear an issue's boost (#256): boosting
 * pins open work to the top, so it is dropped once the issue is resolved
 * or closed. Reopening does not re-boost.
 */
export function shouldUnboostOnStatusChange({
  isBoosted,
  from,
  to,
}: {
  isBoosted: boolean;
  from: string;
  to: string | undefined;
}): boolean {
  return Boolean(isBoosted && to && to !== from && FINISHED_STATUSES.includes(to));
}
