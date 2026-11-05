"use server";

import { revalidatePath } from "next/cache";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { prisma } from "@/lib/prisma";
import { bugInTenant, currentTenantIdFor } from "@/lib/tenant-context";
import { requireUser } from "@/lib/auth-helpers";
import { finishedWatchedWhere } from "@/lib/watching";

/** Watch or unwatch an issue (#216). Anyone who can see the issue may. */
export async function setWatchingAction(
  bugId: string,
  watching: boolean,
): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  const bug = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(user.id)) },
    select: { id: true, isDeleted: true },
  });
  if (!bug || bug.isDeleted) return { error: "Issue not found" };

  await prisma.issueWatch.upsert({
    where: { userId_bugId: { userId: user.id, bugId } },
    create: { userId: user.id, bugId, watching: Boolean(watching) },
    update: { watching: Boolean(watching) },
  });
  revalidateIssue();
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath(`/bugs/${bugId}`);
  // The "Issues I'm watching" list (#312).
  revalidatePath("/bugs");
  return { ok: true };
}

/**
 * Stop watching every resolved or closed issue you're watching (#312).
 *
 * Writes an explicit "not watching" row for each, rather than deleting rows:
 * an issue you reported or were assigned to is watched by default, so
 * deleting your row would leave you watching it. An explicit row is also
 * what keeps `ensureWatching` from quietly re-adding you.
 */
export async function unwatchFinishedAction(): Promise<{
  ok?: boolean;
  error?: string;
  count?: number;
}> {
  const user = await requireUser();
  const bugs = await prisma.bug.findMany({
    where: { ...finishedWatchedWhere(user.id), ...bugInTenant(await currentTenantIdFor(user.id)) },
    select: { id: true },
  });
  const ids = bugs.map((b) => b.id);
  if (ids.length === 0) {
    revalidatePath("/[org]/[project]", "layout");
    revalidatePath("/bugs");
    return { ok: true, count: 0 };
  }
  await prisma.$transaction([
    prisma.issueWatch.updateMany({
      where: { userId: user.id, bugId: { in: ids } },
      data: { watching: false },
    }),
    prisma.issueWatch.createMany({
      data: ids.map((bugId) => ({ userId: user.id, bugId, watching: false })),
      skipDuplicates: true,
    }),
  ]);
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath("/bugs");
  return { ok: true, count: ids.length };
}
