import { prisma } from "@/lib/prisma";

/**
 * A project's health (#project-health): six checks on where its work stands,
 * each passing, warning or failing, and a 0–100 score from them. It reads the
 * live data on each request, for every project of an organisation at once.
 */

export type CheckState = "ok" | "warn" | "bad";
export type HealthCheck = { key: string; label: string; state: CheckState; message: string };
export type HealthStatus = "healthy" | "at_risk" | "critical";
export type ProjectHealth = { score: number; status: HealthStatus; summary: string; checks: HealthCheck[] };

const DAY = 24 * 60 * 60 * 1000;
const POINTS: Record<CheckState, number> = { ok: 100, warn: 55, bad: 15 };

export const HEALTH_LABEL: Record<HealthStatus, string> = { healthy: "Healthy", at_risk: "At risk", critical: "Critical" };

export function healthStatus(score: number): HealthStatus {
  return score >= 75 ? "healthy" : score >= 50 ? "at_risk" : "critical";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function check(key: string, label: string, count: number, warnAt: number, badAt: number, message: (n: number) => string): HealthCheck {
  const state: CheckState = count >= badAt ? "bad" : count >= warnAt ? "warn" : "ok";
  return { key, label, state, message: message(count) };
}

/** Health for each of the given projects, by project id. */
export async function projectHealthFor(organisationId: string, projectIds: string[]): Promise<Map<string, ProjectHealth>> {
  const now = Date.now();
  const scope = { organisationId, projectId: { in: projectIds }, isDeleted: false, duplicateOfId: null };
  const count = (where: object) =>
    prisma.bug.groupBy({ by: ["projectId"], where: { ...scope, ...where }, _count: { _all: true } });

  const [unconfirmed, unawarded, overdue, reviews, mergeErrors, waitingMerge, shipped, active] = await Promise.all([
    // Reports agents haven't confirmed in two days.
    count({ substatus: "requires_confirmation", createdAt: { lt: new Date(now - 2 * DAY) } }),
    // Confirmed issues with bids that nobody has been awarded.
    count({ substatus: "open", bids: { some: { withdrawnAt: null } }, claims: { none: { status: { in: ["offered", "active"] }, releasedAt: null } } }),
    // Claimed work past its deadline.
    count({ claims: { some: { status: "active", releasedAt: null, deliverBy: { lt: new Date(now) } } } }),
    // Delivered work waiting to be judged or reviewed.
    count({ status: "done" }),
    // Pull requests that can't merge.
    count({ substatus: "error" }),
    // Accepted work waiting to be merged for over a day.
    count({ substatus: "ready_to_merge", updatedAt: { lt: new Date(now - DAY) } }),
    // Shipped in the last two weeks.
    count({ status: "resolved", updatedAt: { gte: new Date(now - 14 * DAY) } }),
    // Anything still being worked on, so a quiet project isn't marked as not shipping.
    count({ status: { in: ["open", "in_progress", "done", "merge"] } }),
  ]);
  const of = (rows: Array<{ projectId: string; _count: { _all: number } }>, id: string) => rows.find((r) => r.projectId === id)?._count._all ?? 0;

  const result = new Map<string, ProjectHealth>();
  for (const id of projectIds) {
    const shippedCount = of(shipped, id);
    const activeCount = of(active, id);
    const checks: HealthCheck[] = [
      check("confirm", "Confirmation", of(unconfirmed, id), 3, 10, (n) => `${plural(n, "report")} unconfirmed for 2+ days`),
      check("award", "Bids", of(unawarded, id), 2, 6, (n) => `${plural(n, "issue")} with bids waiting for an award`),
      check("deadline", "Deadlines", of(overdue, id), 1, 3, (n) => `${plural(n, "claim")} past the deadline`),
      check("review", "Reviews", of(reviews, id), 5, 15, (n) => `${plural(n, "review")} waiting`),
      check("merge", "Merging", of(mergeErrors, id) * 2 + of(waitingMerge, id), 1, 4, () =>
        of(mergeErrors, id) ? `${plural(of(mergeErrors, id), "pull request")} can't merge` : `${plural(of(waitingMerge, id), "fix", "fixes")} waiting to merge`),
      {
        key: "ship",
        label: "Shipping",
        state: shippedCount > 0 || activeCount === 0 ? "ok" : activeCount >= 10 ? "bad" : "warn",
        message: shippedCount > 0 ? `${plural(shippedCount, "fix", "fixes")} live in 2 weeks` : "Nothing went live in 2 weeks",
      },
    ];
    const score = Math.round(checks.reduce((sum, c) => sum + POINTS[c.state], 0) / checks.length);
    // The worst problems first, as the line under the name.
    const problems = [...checks.filter((c) => c.state === "bad"), ...checks.filter((c) => c.state === "warn")];
    const summary = problems.length ? problems.slice(0, 2).map((c) => c.message).join(" · ") : "All checks passing";
    result.set(id, { score, status: healthStatus(score), summary, checks });
  }
  return result;
}
