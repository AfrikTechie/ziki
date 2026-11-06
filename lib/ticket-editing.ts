import type { MembershipRole } from "@prisma/client";
import { isOrganisationAdmin } from "@/lib/organisation-role";
import type { AppRole } from "@/lib/roles";

export const TICKET_EDIT_ERRORS = {
  unauthorized: "Only the reporter, or an owner or admin of this organisation, can edit this issue",
  notFound: "Issue not found",
  invalidTitle: "Title must be between 3 and 200 characters",
  invalidDescription: "Description must be between 10 and 5000 characters",
  failed: "Could not update issue. Please try again.",
} as const;

export type CanEditTicketParams = {
  actorId?: string | null;
  actorRole?: AppRole | null;
  membershipRole?: MembershipRole | null;
  reporterId?: string | null;
};

/**
 * Checks whether a user can edit an issue's title and description.
 * Allowed: the reporter, or an owner / admin of the organisation. A site-wide
 * admin who is only a member cannot edit someone else's issue.
 */
export function canEditTicket({
  actorId,
  actorRole,
  membershipRole,
  reporterId,
}: CanEditTicketParams): boolean {
  if (!actorId) return false;
  if (isOrganisationAdmin(membershipRole, actorRole)) return true;
  return Boolean(reporterId && actorId === reporterId);
}

/**
 * Calculates which content fields changed between the existing ticket and the submitted edits.
 */
export function getChangedEditFields(
  existing: { title: string; description: string },
  updated: { title: string; description: string },
): ("title" | "description")[] {
  const fields: ("title" | "description")[] = [];
  if (existing.title.trim() !== updated.title.trim()) {
    fields.push("title");
  }
  if (existing.description.trim() !== updated.description.trim()) {
    fields.push("description");
  }
  return fields;
}

export type ProofLinkChanges = {
  added: string[];
  removed: string[];
};

/** The proof links an edit adds and removes (#737). Order is ignored. */
export function getProofLinkChanges(existing: string[], updated: string[]): ProofLinkChanges {
  const before = new Set(existing);
  const after = new Set(updated);
  return {
    added: updated.filter((url) => !before.has(url)),
    removed: existing.filter((url) => !after.has(url)),
  };
}

/** e.g. "added 2 proof links", "removed a proof link", "added a proof link and removed a proof link". */
export function formatProofLinkSummary({ added, removed }: ProofLinkChanges): string {
  const count = (n: number) => (n === 1 ? "a proof link" : `${n} proof links`);
  const parts: string[] = [];
  if (added.length > 0) parts.push(`added ${count(added.length)}`);
  if (removed.length > 0) parts.push(`removed ${count(removed.length)}`);
  if (parts.length === 0) return "edited the proof links";
  return parts.join(" and ");
}

/**
 * Returns formatted human-readable summary for activity log.
 * e.g. "edited the title and description", "edited the title", "edited the description"
 */
export function formatEditSummary(fields: ("title" | "description")[]): string {
  if (fields.length === 0) return "edited this ticket";
  if (fields.includes("title") && fields.includes("description")) {
    return "edited the title and description";
  }
  if (fields.includes("title")) {
    return "edited the title";
  }
  return "edited the description";
}
