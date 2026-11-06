import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { IssueApiError } from "@/lib/agent-api/errors";
import { isOpenBid } from "@/lib/open-bids";
import { workflowFor } from "@/lib/workflow";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Bidder capacity (#bidder-capacity). The project's `maxActiveClaims` is how
 * much work one person's agents may hold in it at once: live offers (inside
 * the offer window) plus active claims on issues In progress (#760). An award to a bid
 * whose person is already at that load is refused with 409 `at_capacity`
 * (lib/agent-api/bid.ts `awardInTransaction`), the work feed shows each bid's
 * load and offers no award for one at capacity, and the issue page marks such
 * a bid "at capacity". Accepting an offer keeps its own check on active claims
 * (lib/agent-api/offer.ts).
 */

/**
 * #760: what counts is work still to do: live offers, and active claims on
 * issues In progress. A claim on delivered work (Done, Merge) keeps holding
 * the issue for heartbeats and points but no longer takes a slot; work sent
 * back to In progress counts again.
 */
const OPEN_WORK = { status: "in_progress" } as const;

/** The work a person holds in a project now: live offers plus active claims on issues In progress (#760). */
export async function holdLoad(
  db: Db,
  scope: { organisationId: string; projectId: string; userId: string },
  offerWindowSeconds: number,
): Promise<number> {
  return db.issueClaim.count({
    where: {
      beneficiaryUserId: scope.userId,
      bug: { organisationId: scope.organisationId, projectId: scope.projectId, isDeleted: false },
      ...holdsWork(offerWindowSeconds),
    },
  });
}

/** A live offer, a planning claim (#plan-review), or an active claim on an issue still In progress (#760). */
function holdsWork(offerWindowSeconds: number, now = Date.now()): Prisma.IssueClaimWhereInput {
  return {
    releasedAt: null,
    OR: [
      { status: "active", bug: OPEN_WORK },
      { status: "planning" },
      { status: "offered", offeredAt: { gt: new Date(now - offerWindowSeconds * 1000) } },
    ],
  };
}

/** `holdLoad` for several people at once; a person holding nothing is 0. */
export async function holdLoads(
  db: Db,
  scope: { organisationId: string; projectId: string },
  userIds: string[],
  offerWindowSeconds: number,
): Promise<Map<string, number>> {
  const loads = new Map<string, number>(userIds.map((id) => [id, 0]));
  if (!userIds.length) return loads;
  const rows = await db.issueClaim.groupBy({
    by: ["beneficiaryUserId"],
    where: {
      beneficiaryUserId: { in: [...new Set(userIds)] },
      bug: { organisationId: scope.organisationId, projectId: scope.projectId, isDeleted: false },
      ...holdsWork(offerWindowSeconds),
    },
    _count: { _all: true },
  });
  for (const row of rows) loads.set(row.beneficiaryUserId, row._count._all);
  return loads;
}

export function isAtCapacity(load: number, capacity: number): boolean {
  return load >= capacity;
}

/** "Pixel: 2 of 2 — at capacity", or "Pixel: 1 of 2", for the feed. */
export function capacityLine(agentName: string, load: number, capacity: number): string {
  return `${agentName}: ${load} of ${capacity}${isAtCapacity(load, capacity) ? " — at capacity" : ""}`;
}

/** Why every bid on an issue is blocked, in the feed's words. */
export const EVERY_BIDDER_AT_CAPACITY = "every bidder is at capacity; wait or ask for more bids";

/** The 409 an award to a bid at capacity answers with. */
export function atCapacityError(load: number, capacity: number): IssueApiError {
  const message = `This bidder already holds ${load} of ${capacity} offers and claims on work In progress allowed in this project; award another bid or wait until it has capacity.`;
  return new IssueApiError(409, message, { error: "at_capacity", message, load, capacity });
}

/** True for the refusal `atCapacityError` makes. */
export function isAtCapacityError(error: unknown): boolean {
  return error instanceof IssueApiError && error.body?.error === "at_capacity";
}

/**
 * Marks each open bid whose person is at the project's capacity with
 * `atCapacity: true`, for the issue page's bids panel; every other bid gets false.
 */
export async function markAtCapacity<T extends { beneficiaryUserId: string; awardedAt?: Date | string | null; withdrawnAt?: Date | string | null }>(
  scope: { organisationId: string; projectId: string },
  entries: T[],
  db: Db = prisma,
): Promise<(T & { atCapacity: boolean })[]> {
  const open = entries.filter(isOpenBid);
  if (!open.length) return entries.map((entry) => ({ ...entry, atCapacity: false }));
  const { offerWindowSeconds, maxActiveClaims } = await workflowFor(scope.projectId, db);
  const loads = await holdLoads(db, scope, open.map((entry) => entry.beneficiaryUserId), offerWindowSeconds);
  return entries.map((entry) => ({
    ...entry,
    atCapacity: isOpenBid(entry) && isAtCapacity(loads.get(entry.beneficiaryUserId) ?? 0, maxActiveClaims),
  }));
}

/** Refuses with 409 `at_capacity` when the person is at the project's capacity. */
export async function assertUnderCapacity(
  db: Db,
  scope: { organisationId: string; projectId: string; userId: string },
  workflow: { offerWindowSeconds: number; maxActiveClaims: number },
): Promise<void> {
  const load = await holdLoad(db, scope, workflow.offerWindowSeconds);
  if (isAtCapacity(load, workflow.maxActiveClaims)) throw atCapacityError(load, workflow.maxActiveClaims);
}
