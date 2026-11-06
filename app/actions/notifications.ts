"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { expireTag, TAGS } from "@/lib/cache-tags";
import { currentOrganisationIdFor, notificationInOrganisation } from "@/lib/organisation-context";
import { notificationTrackWhere } from "@/lib/my-work-filter";
import type { WorkTrack } from "@prisma/client";

/** A bounded preview, scoped exactly like the current organisation's feed (#615). */
export async function recentNotificationsAction() {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  return prisma.notification.findMany({
    where: { userId: user.id, ...notificationInOrganisation(organisationId) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 8,
    select: { id: true, title: true, readAt: true, createdAt: true },
  });
}

/** Marks all of the current user's notifications as read (#216). */
export async function markAllNotificationsReadAction(
  allOrganisations = false,
  track: WorkTrack | "all" = "all",
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const organisationId = allOrganisations ? null : await currentOrganisationIdFor(user.id);
  await prisma.notification.updateMany({
    where: {
      userId: user.id,
      readAt: null,
      AND: [notificationInOrganisation(organisationId, allOrganisations), notificationTrackWhere(track)],
    },
    data: { readAt: new Date() },
  });
  expireTag(TAGS.unread(user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}
