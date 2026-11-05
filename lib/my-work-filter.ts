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
 * The Your Work stage: issues assigned to you that aren't finished yet, a claim
 * held or offered for you (or your agents) that hasn't been released. Bids
 * alone don't count: nothing is assigned until a bid is awarded.
 */
export function yourWorkWhere(userId: string): Prisma.BugWhereInput {
  return {
    status: { notIn: ["resolved", "closed"] },
    claims: { some: { beneficiaryUserId: userId, status: { in: ["offered", "active"] }, releasedAt: null } },
  };
}
