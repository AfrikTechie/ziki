"use server";

import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { beingChecked, totalEarned } from "@/lib/earnings";

export type WithdrawDetails = { available: number; checking: number; wallet: string | null; workspace: string | null; workspaceSlug: string | null };

/**
 * What the Withdraw window shows (#earnings, Chloe's call): the money you made in the workspace you're in, read when
 * it opens so ordinary pages don't pay for it. Only a workspace you belong to or joined a project of counts; any other
 * reads as nothing. Your own money only.
 */
export async function withdrawDetailsAction(organisationId: string | null): Promise<WithdrawDetails> {
  const user = await requireUser();
  const organisation = organisationId
    ? await prisma.organisation.findFirst({
        where: {
          id: organisationId,
          OR: [{ memberships: { some: { userId: user.id } } }, { projects: { some: { memberships: { some: { userId: user.id } } } } }],
        },
        select: { id: true, name: true, slug: true },
      })
    : null;
  // Someone in no workspace (an earner who only joined projects) has no workspace to scope to: count all their
  // money, as the header's $ does (lib/earnings.ts headerEarnings), so the two always agree. A workspace named
  // here that isn't theirs still reads as nothing.
  const noWorkspace = organisationId === null;
  const scope = organisation?.id ?? null;
  const [total, checking, row] = await Promise.all([
    scope ? totalEarned(prisma, user.id, scope) : noWorkspace ? totalEarned(prisma, user.id) : Promise.resolve(0),
    scope ? beingChecked(prisma, user.id, scope) : noWorkspace ? beingChecked(prisma, user.id) : Promise.resolve(0),
    prisma.user.findUnique({ where: { id: user.id }, select: { walletAddress: true } }),
  ]);
  return { available: Math.max(0, total), checking, wallet: row?.walletAddress ?? null, workspace: organisation?.name ?? null, workspaceSlug: organisation?.slug ?? null };
}
