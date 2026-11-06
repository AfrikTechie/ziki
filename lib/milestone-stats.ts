import { PRODUCT_TRACK } from "@/lib/marketing/track";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/lib/roles";
import { isAdmin } from "@/lib/roles";
import { isOrganisationAdminRole } from "@/lib/agents/membership";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { DONE_STATUSES, milestoneProgress, type MilestoneProgress } from "@/lib/milestones";

export type MilestoneScope =
  | { ok: true; organisationId: string; organisationName: string; userId: string }
  | { ok: false; forbidden: boolean; error: string };

/**
 * The organisation whose milestones this person may change.
 * Site admins and the organisation's owners and admins may.
 */
export async function milestoneScopeFor(user: {
  id: string;
  role?: AppRole | null;
}): Promise<MilestoneScope> {
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) {
    return {
      ok: false,
      forbidden: false,
      error: "Open an organisation before managing milestones.",
    };
  }

  const [organisation, membership] = await Promise.all([
    prisma.organisation.findUnique({ where: { id: organisationId }, select: { id: true, name: true } }),
    prisma.membership.findUnique({
      where: { organisationId_userId: { organisationId, userId: user.id } },
      select: { role: true },
    }),
  ]);
  if (!organisation) {
    return {
      ok: false,
      forbidden: false,
      error: "The selected organisation no longer exists.",
    };
  }
  const allowed = isAdmin(user.role) || isOrganisationAdminRole(membership?.role, user.role);
  if (!allowed) {
    return {
      ok: false,
      forbidden: true,
      error: "Only organisation admins may manage milestones.",
    };
  }
  return { ok: true, organisationId, organisationName: organisation.name, userId: user.id };
}

export type MilestoneSummary = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  isClosed: boolean;
  progress: MilestoneProgress;
};

/**
 * Milestones with closed/total counts from one grouped query, however many
 * there are. Deleted issues don't count.
 */
export async function loadMilestoneSummaries(
  where: Prisma.MilestoneWhereInput = {},
): Promise<MilestoneSummary[]> {
  // A string organisationId also scopes the progress counts to the same organisation.
  // Keep it out of the Bug filter when it is a richer Prisma filter.
  const organisationId = typeof where.organisationId === "string" ? where.organisationId : undefined;
  const [milestones, groups] = await Promise.all([
    prisma.milestone.findMany({
      where,
      // Soonest due first; undated ones after, by name.
      orderBy: [{ isClosed: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { title: "asc" }],
      select: { id: true, title: true, description: true, dueDate: true, isClosed: true },
    }),
    prisma.bug.groupBy({
      by: ["milestoneId", "status"],
      where: { ...PRODUCT_TRACK, isDeleted: false, milestoneId: { not: null }, ...(organisationId ? { organisationId } : {}) },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map<string, { done: number; total: number }>();
  for (const g of groups) {
    if (!g.milestoneId) continue;
    const c = counts.get(g.milestoneId) ?? { done: 0, total: 0 };
    c.total += g._count._all;
    if (DONE_STATUSES.includes(g.status)) c.done += g._count._all;
    counts.set(g.milestoneId, c);
  }
  return milestones.map((m) => {
    const c = counts.get(m.id) ?? { done: 0, total: 0 };
    return { ...m, progress: milestoneProgress(c.done, c.total) };
  });
}
