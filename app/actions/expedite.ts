"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { bugInOrganisation, currentOrganisationIdFor } from "@/lib/organisation-context";
import { publishWebEvent } from "@/lib/agent-api/web-events";
import type { SpeedActionType } from "@/components/speed-request-modal";
import { DAILY_EXPEDITE_QUOTA } from "@/lib/expedite-constants";

export type ExpediteResult =
  | {
      success: true;
      isExpedited: boolean;
      quotaRemaining: number;
      actionType?: SpeedActionType;
    }
  | {
      success: false;
      error: string;
      quotaRemaining?: number;
    };

/**
 * Calculates remaining daily expedite requests for the given user today (UTC).
 */
export async function getUserDailyExpediteQuota(userId: string) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const used = await prisma.bugActivity.count({
    where: {
      actorId: userId,
      type: "boosted",
      createdAt: { gte: startOfDay },
      metadata: {
        path: ["field"],
        equals: "expedited",
      },
    },
  });

  const remaining = Math.max(0, DAILY_EXPEDITE_QUOTA - used);
  return {
    used,
    remaining,
    total: DAILY_EXPEDITE_QUOTA,
  };
}

/**
 * Expedites an issue into the Work Stream Priority Blocking Queue.
 * Deducts 1 quota from user's daily allocation (3/day).
 */
export async function expediteBugAction(
  bugId: string,
  actionType: SpeedActionType,
  urgencyNote?: string
): Promise<ExpediteResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) {
    return { success: false, error: "Workspace membership required." };
  }

  if (!bugId || typeof bugId !== "string") {
    return { success: false, error: "Invalid issue ID." };
  }

  const quota = await getUserDailyExpediteQuota(user.id);
  if (quota.remaining <= 0) {
    return {
      success: false,
      error: `Daily urgency quota exhausted (${DAILY_EXPEDITE_QUOTA}/${DAILY_EXPEDITE_QUOTA} used today). Quota resets at 00:00 UTC.`,
      quotaRemaining: 0,
    };
  }

  const bug = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInOrganisation(organisationId) },
    select: { id: true, number: true, title: true, isDeleted: true, project: { select: { slug: true } } },
  });

  if (!bug || bug.isDeleted) {
    return { success: false, error: "Issue not found." };
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Elevate issue priority: boost it so it surfaces at the top of feeds & lists
    await tx.bug.update({
      where: { id: bugId },
      data: {
        isBoosted: true,
        boostedAt: now,
      },
    });

    // Record activity log with urgency metadata
    await tx.bugActivity.create({
      data: {
        bugId,
        actorId: user.id,
        type: "boosted",
        summary: `Expedited issue into Priority Blocking Queue for ${actionType}${
          urgencyNote ? `: "${urgencyNote}"` : ""
        }`,
        metadata: {
          field: "expedited",
          actionType,
          urgencyNote: urgencyNote?.trim() || null,
          expeditedAt: now.toISOString(),
          quotaRemaining: quota.remaining - 1,
        },
      },
    });

    // Broadcast web event to agent event stream & SSE clients
    await publishWebEvent(tx, {
      bugId,
      type: "issue.updated",
      actorUserId: user.id,
      payload: {
        isExpedited: true,
        actionType,
        urgencyNote: urgencyNote?.trim() || null,
      },
    });
  });

  revalidatePath(`/issues/${bug.number}`);
  revalidatePath("/feed");
  revalidatePath("/issues");

  return {
    success: true,
    isExpedited: true,
    quotaRemaining: quota.remaining - 1,
    actionType,
  };
}

/**
 * Removes an issue from the Priority Blocking Queue and refunds daily quota.
 */
export async function cancelExpediteBugAction(
  bugId: string
): Promise<ExpediteResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) {
    return { success: false, error: "Workspace membership required." };
  }

  const bug = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInOrganisation(organisationId) },
    select: { id: true, number: true, project: { select: { slug: true } } },
  });

  if (!bug) {
    return { success: false, error: "Issue not found." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.bug.update({
      where: { id: bugId },
      data: {
        isBoosted: false,
        boostedAt: null,
      },
    });

    await tx.bugActivity.create({
      data: {
        bugId,
        actorId: user.id,
        type: "unboosted",
        summary: "Removed issue from Priority Blocking Queue",
        metadata: {
          field: "unexpedited",
        },
      },
    });

    await publishWebEvent(tx, {
      bugId,
      type: "issue.updated",
      actorUserId: user.id,
      payload: { isExpedited: false },
    });
  });

  const quota = await getUserDailyExpediteQuota(user.id);

  revalidatePath(`/issues/${bug.number}`);
  revalidatePath("/feed");
  revalidatePath("/issues");

  return {
    success: true,
    isExpedited: false,
    quotaRemaining: quota.remaining,
  };
}
