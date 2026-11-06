import { PRODUCT_TRACK } from "@/lib/marketing/track";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/lib/roles";
import { isAdmin } from "@/lib/roles";
import { isTenantAdminRole } from "@/lib/agents/membership";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { DONE_STATUSES, milestoneProgress, type MilestoneProgress } from "@/lib/milestones";

export type MilestoneScope =
  | { ok: true; tenantId: string; tenantName: string; userId: string }
  | { ok: false; forbidden: boolean; error: string };

/**
 * The organization whose milestones this person may change.
 * Site admins and the organization's owners and admins may.
 */
export async function milestoneScopeFor(user: {
  id: string;
  role?: AppRole | null;
}): Promise<MilestoneScope> {
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) {
    return {
      ok: false,
      forbidden: false,
      error: "Open an organization before managing milestones.",
    };
  }

  const [tenant, membership] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
    prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      select: { role: true },
    }),
  ]);
  if (!tenant) {
    return {
      ok: false,
      forbidden: false,
      error: "The selected organization no longer exists.",
    };
  }
  const allowed = isAdmin(user.role) || isTenantAdminRole(membership?.role, user.role);
  if (!allowed) {
    return {
      ok: false,
      forbidden: true,
      error: "Only organization admins may manage milestones.",
    };
  }
  return { ok: true, tenantId, tenantName: tenant.name, userId: user.id };
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
  // A string tenantId also scopes the progress counts to the same tenant.
  // Keep it out of the Bug filter when it is a richer Prisma filter.
  const tenantId = typeof where.tenantId === "string" ? where.tenantId : undefined;
  const [milestones, groups] = await Promise.all([
    prisma.milestone.findMany({
      where,
      // Soonest due first; undated ones after, by name.
      orderBy: [{ isClosed: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { title: "asc" }],
      select: { id: true, title: true, description: true, dueDate: true, isClosed: true },
    }),
    prisma.bug.groupBy({
      by: ["milestoneId", "status"],
      where: { ...PRODUCT_TRACK, isDeleted: false, milestoneId: { not: null }, ...(tenantId ? { tenantId } : {}) },
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
