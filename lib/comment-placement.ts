import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Where a new comment goes: under one stage entry, under a comment, or on the issue itself. */
export type CommentPlacementInput = {
  confirmationId?: string;
  bidId?: string;
  deliveryId?: string;
  testVerdictId?: string;
  mergeReviewId?: string;
  planId?: string;
  parentId?: string;
};

export type CommentPlacement = {
  confirmationId: string | null;
  bidId: string | null;
  deliveryId: string | null;
  testVerdictId: string | null;
  mergeReviewId: string | null;
  planId: string | null;
  parentId: string | null;
  /** Whom the comment answers: the entry's or the parent comment's author, for notifications. */
  parentAuthorId: string | null;
};

/** Why a comment can't go where it was sent. `code` is the agent API's error code. */
export class CommentPlacementError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The one rule for where a comment may go, for people and agents alike, at
 * every stage: on the issue itself, a one-level reply to a comment there, or
 * a reply to one stage entry (a confirmation, a bid, a delivery, a test
 * verdict or a merge review). Anyone may comment on any issue at any time, so
 * long as it helps; decisions are still the stage's entries.
 */
export async function placeComment(
  db: Db,
  bug: { id: string },
  input: CommentPlacementInput,
): Promise<CommentPlacement> {
  const placement: CommentPlacement = {
    confirmationId: input.confirmationId ?? null,
    bidId: input.bidId ?? null,
    deliveryId: input.deliveryId ?? null,
    testVerdictId: input.testVerdictId ?? null,
    mergeReviewId: input.mergeReviewId ?? null,
    planId: input.planId ?? null,
    parentId: input.parentId ?? null,
    parentAuthorId: null,
  };
  const entries = [placement.confirmationId, placement.bidId, placement.deliveryId, placement.testVerdictId, placement.mergeReviewId, placement.planId].filter(Boolean);
  if (entries.length > 1 || (entries.length === 1 && placement.parentId)) {
    throw new CommentPlacementError(
      422,
      "one_place",
      "Send one place for the comment: one of confirmationId, bidId, deliveryId, testVerdictId, mergeReviewId, planId or parentId.",
    );
  }

  if (placement.confirmationId) {
    const entry = await db.issueConfirmation.findFirst({ where: { id: placement.confirmationId, bugId: bug.id }, select: { onBehalfOfUserId: true } });
    if (!entry) throw new CommentPlacementError(422, "not_found", "That confirmation is not on this issue.");
    return { ...placement, parentAuthorId: entry.onBehalfOfUserId };
  }
  if (placement.bidId) {
    const bid = await db.issueBid.findFirst({ where: { id: placement.bidId, bugId: bug.id }, select: { beneficiaryUserId: true } });
    if (!bid) throw new CommentPlacementError(422, "not_found", "That bid is not on this issue.");
    return { ...placement, parentAuthorId: bid.beneficiaryUserId };
  }
  if (placement.deliveryId) {
    const delivery = await db.delivery.findFirst({ where: { id: placement.deliveryId, bugId: bug.id }, select: { beneficiaryUserId: true } });
    if (!delivery) throw new CommentPlacementError(422, "not_found", "That delivery is not on this issue.");
    return { ...placement, parentAuthorId: delivery.beneficiaryUserId };
  }
  if (placement.testVerdictId) {
    const verdict = await db.testVerdict.findFirst({ where: { id: placement.testVerdictId, bugId: bug.id }, select: { onBehalfOfUserId: true } });
    if (!verdict) throw new CommentPlacementError(422, "not_found", "That test verdict is not on this issue.");
    return { ...placement, parentAuthorId: verdict.onBehalfOfUserId };
  }
  if (placement.mergeReviewId) {
    const review = await db.mergeReview.findFirst({ where: { id: placement.mergeReviewId, bugId: bug.id }, select: { onBehalfOfUserId: true } });
    if (!review) throw new CommentPlacementError(422, "not_found", "That merge review is not on this issue.");
    return { ...placement, parentAuthorId: review.onBehalfOfUserId };
  }
  if (placement.planId) {
    const plan = await db.plan.findFirst({ where: { id: placement.planId, bugId: bug.id }, select: { ownerId: true } });
    if (!plan) throw new CommentPlacementError(422, "not_found", "That plan is not on this issue.");
    return { ...placement, parentAuthorId: plan.ownerId };
  }

  if (placement.parentId) {
    // Replies are one level deep, under a comment on the issue itself.
    const parent = await db.comment.findFirst({
      where: {
        id: placement.parentId,
        bugId: bug.id,
        deletedAt: null,
        parentId: null,
        confirmationId: null,
        bidId: null,
        deliveryId: null,
        testVerdictId: null,
        mergeReviewId: null,
        planId: null,
      },
      select: { authorId: true },
    });
    if (!parent) throw new CommentPlacementError(422, "not_found", "That comment is not a comment on this issue you can reply to.");
    return { ...placement, parentAuthorId: parent.authorId };
  }
  return placement;
}
