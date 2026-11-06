import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { workflowFor } from "@/lib/workflow";

type Db = PrismaClient | Prisma.TransactionClient;

/** How an agent got an issue. */
export type HoldVia = "bid" | "assigned" | "offer" | "claim";

/** The agent that has or has been offered the issue, from its claim: who, for whom, how and when. */
export type IssueHold = {
  id: string;
  agentName: string;
  personName: string;
  via: HoldVia;
  /** Who handed it out, when a person or manager did. */
  dispatcherName: string | null;
  status: "offered" | "planning" | "active";
  offeredAt: Date | null;
  claimedAt: Date | null;
  deliverBy: Date | null;
  /** Earliest heartbeat or delivery deadline that can release an undelivered claim. */
  releaseAt: Date | null;
  /** Heartbeat and delivery clocks pause while the agent waits for its owner. */
  waitingOnOwner: boolean;
  /** A linked pull request is in review; heartbeat no longer releases the claim. */
  hasPullRequest: boolean;
};

/**
 * What holds an issue (#stale-assignee): an active claim, a planning claim
 * (a complex issue's award under plan review, #plan-review; the plan sweeper
 * releases it when its window runs out), or an offer still inside the
 * project's offer window. Nothing else does: an assignee with
 * neither is stale. The award gate, the work feed's awards and ready issues,
 * the assign route and the issue page's People box all use this one rule,
 * `liveHoldWhere` for a query and `isLiveHold` for a claim already read.
 */
export function liveHoldWhere(offerWindowSeconds: number, now = Date.now()): Prisma.IssueClaimWhereInput {
  return {
    releasedAt: null,
    OR: [
      { status: "active" },
      { status: "planning" },
      { status: "offered", offeredAt: { gt: new Date(now - offerWindowSeconds * 1000) } },
    ],
  };
}

/** `liveHoldWhere` for one claim already read. An offer with no offer time has expired. */
export function isLiveHold(
  claim: { status: string; releasedAt?: Date | null; offeredAt?: Date | null },
  offerWindowSeconds: number,
  now = Date.now(),
): boolean {
  if (claim.releasedAt) return false;
  if (claim.status === "active" || claim.status === "planning") return true;
  return claim.status === "offered" && Boolean(claim.offeredAt) && claim.offeredAt!.getTime() > now - offerWindowSeconds * 1000;
}

/** The claim that holds the issue now (`liveHoldWhere`), or null when nothing does. */
export async function liveHold(
  bug: { id: string; projectId: string },
  db: Db = prisma,
): Promise<{ id: string; status: string; beneficiaryUserId: string } | null> {
  const { offerWindowSeconds } = await workflowFor(bug.projectId, db);
  return db.issueClaim.findFirst({
    where: { bugId: bug.id, ...liveHoldWhere(offerWindowSeconds) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, beneficiaryUserId: true },
  });
}

/**
 * The assignee to show on an issue: none on an Open issue that nothing holds
 * (`liveHold`), since that assignment is stale (#stale-assignee).
 */
export function shownAssignee<T>(status: string, assignee: T | null, held: boolean): T | null {
  return status === "open" && !held ? null : assignee;
}

/**
 * Who has the issue now, or has been offered it: its newest claim that is
 * still held, or null. The claim is the record of who has the work
 * (`IssueClaim`); a linked bid means it was won by bidding, a dispatcher that
 * someone assigned it, an offer that the agent accepted one.
 */
export async function currentHold(bugId: string, db: Db = prisma): Promise<IssueHold | null> {
  const claim = await db.issueClaim.findFirst({
    where: { bugId, releasedAt: null, status: { in: ["offered", "planning", "active"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      offeredAt: true,
      claimedAt: true,
      lastHeartbeatAt: true,
      deliverBy: true,
      waitingOnOwnerSince: true,
      agent: { select: { name: true } },
      beneficiary: { select: { name: true } },
      dispatcher: { select: { name: true } },
      awardedBid: { select: { id: true } },
      bug: { select: { projectId: true, pullRequestUrl: true } },
    },
  });
  if (!claim || (claim.status !== "offered" && claim.status !== "planning" && claim.status !== "active")) return null;
  // An offer past the project's offer window has expired, even before the sweeper releases it.
  if (claim.status === "offered") {
    const { offerWindowSeconds } = await workflowFor(claim.bug.projectId, db);
    if (!isLiveHold(claim, offerWindowSeconds)) return null;
  }
  const lastHeartbeat = claim.lastHeartbeatAt ?? claim.claimedAt;
  const { heartbeatMinutes } = await workflowFor(claim.bug.projectId, db);
  const heartbeatDeadline = lastHeartbeat
    ? new Date(lastHeartbeat.getTime() + heartbeatMinutes * 60_000)
    : null;
  const deadlines = [heartbeatDeadline, claim.deliverBy].filter((date): date is Date => date !== null);
  const releaseAt = deadlines.length
    ? new Date(Math.min(...deadlines.map((date) => date.getTime())))
    : null;
  return {
    id: claim.id,
    agentName: claim.agent.name,
    personName: claim.beneficiary.name,
    via: claim.awardedBid ? "bid" : claim.dispatcher ? "assigned" : claim.offeredAt ? "offer" : "claim",
    dispatcherName: claim.dispatcher?.name ?? null,
    status: claim.status,
    offeredAt: claim.offeredAt,
    claimedAt: claim.claimedAt,
    deliverBy: claim.deliverBy,
    releaseAt,
    waitingOnOwner: Boolean(claim.waitingOnOwnerSince),
    hasPullRequest: Boolean(claim.bug.pullRequestUrl),
  };
}
