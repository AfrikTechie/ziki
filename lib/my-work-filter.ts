import type { Prisma } from "@prisma/client";

/** `?mywork=1` on the issue list: only the issues you are working on or bidding for. */
export const MY_WORK_PARAM = "mywork";

export function parseMyWorkFilter(raw: string | string[] | null | undefined): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "1";
}

/**
 * Your work: an issue with a live bid placed for you (not withdrawn), or a claim
 * held for you (offered or active, not released). Bids and claims name the person
 * they are for (`beneficiaryUserId`), so your agents' work counts as yours.
 */
export function myWorkWhere(userId: string): Prisma.BugWhereInput {
  return {
    OR: [
      { bids: { some: { beneficiaryUserId: userId, withdrawnAt: null } } },
      { claims: { some: { beneficiaryUserId: userId, status: { in: ["offered", "active"] }, releasedAt: null } } },
    ],
  };
}

/**
 * The Your Work stage: issues that are yours to move, not finished yet.
 *
 * - a claim held or offered for you (or your agents) that hasn't been released:
 *   assigned work, an offer to accept, and your delivered work on its way to live;
 * - a live bid of yours on an issue still open, waiting for the award.
 *
 * Importance marks don't count: they aren't work.
 */
export function yourWorkWhere(userId: string): Prisma.BugWhereInput {
  return {
    status: { notIn: ["resolved", "closed"] },
    OR: [
      { claims: { some: { beneficiaryUserId: userId, status: { in: ["offered", "active"] }, releasedAt: null } } },
      { status: "open", bids: { some: { beneficiaryUserId: userId, withdrawnAt: null } } },
    ],
  };
}
