import { trackFilter } from "@/lib/marketing/track";
import type { WorkTrack } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { workflowFor } from "@/lib/workflow";

/**
 * Idle In progress work (#idle). The one rule: an issue that is In progress,
 * not deleted, and has had no update for the project's `abandonCheckMinutes`
 * (2 hours by default) is idle, and comes to the work feed for someone to
 * decide whether it was abandoned.
 *
 * - Held by an active claim, it is a `sense_check`: other agents vote
 *   Abandoned (lib/agent-api/abandon.ts), a manager agent's vote counting managerVoteWeight.
 * - Held by nobody (assigned to a person, or its claim already released), it
 *   is a `review_idle` for a manager agent, who may take it back to Open with
 *   `POST /api/v1/issues/{id}/reclaim` (lib/agent-api/availability.ts).
 *
 * Its last update is the latest of: the active claim being taken or extended,
 * the issue itself changing, a comment on it, a delivery, an activity-log
 * entry, and its pull request being linked (`github.linked`). Heartbeats don't
 * count: an agent that checks in but changes nothing is what the check is for.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** The latest of the given dates, ignoring missing ones; null when there are none. */
export function lastUpdateAt(dates: (Date | null | undefined)[]): Date | null {
  const times = dates.filter((date): date is Date => date instanceof Date).map((date) => date.getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

/** True once `lastUpdate` is at least `windowMinutes` old. Nothing to measure from is never idle. */
export function isIdle(lastUpdate: Date | null, windowMinutes: number, now = Date.now()): boolean {
  return lastUpdate !== null && now - lastUpdate.getTime() >= windowMinutes * 60_000;
}

/** The claim that holds In progress work, with what the sense check and its votes need. */
export type HeldClaim = {
  id: string;
  agentId: string;
  beneficiaryUserId: string;
  claimedAt: Date | null;
  extendedAt: Date | null;
  agent: { ownerUserId: string; pausedAt: Date | null };
};

export type InProgressWork = {
  bug: { id: string; projectId: string; updatedAt: Date };
  /** The active claim, or null when nobody holds the issue. */
  claim: HeldClaim | null;
  lastUpdate: Date | null;
};

/** When an issue last saw a real update (see the rule above). */
export async function inProgressLastUpdate(
  db: Db,
  bug: { id: string; updatedAt: Date },
  claim: Pick<HeldClaim, "claimedAt" | "extendedAt"> | null,
): Promise<Date | null> {
  const comment = await db.comment.findFirst({ where: { bugId: bug.id, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const delivery = await db.delivery.findFirst({ where: { bugId: bug.id }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  const activity = await db.bugActivity.findFirst({ where: { bugId: bug.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const linked = await db.agentAuditEvent.findFirst({
    where: { bugId: bug.id, action: "github.linked" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return lastUpdateAt([
    claim?.claimedAt,
    claim?.extendedAt,
    bug.updatedAt,
    comment?.createdAt,
    delivery?.updatedAt,
    activity?.createdAt,
    linked?.createdAt,
  ]);
}

/** An In progress issue, who holds it, and when it last saw an update. Null when it is not In progress. */
export async function inProgressWork(db: Db, bugId: string): Promise<InProgressWork | null> {
  const bug = await db.bug.findFirst({
    where: { id: bugId, status: "in_progress", isDeleted: false },
    select: { id: true, projectId: true, updatedAt: true },
  });
  if (!bug) return null;
  const claim = await db.issueClaim.findFirst({
    where: { bugId, status: "active", releasedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, agentId: true, beneficiaryUserId: true, claimedAt: true, extendedAt: true, agent: { select: { ownerUserId: true, pausedAt: true } } },
  });
  return { bug, claim, lastUpdate: await inProgressLastUpdate(db, bug, claim) };
}

export type IdleInProgress = InProgressWork & { lastUpdate: Date; windowMinutes: number };

/** The issue's idle In progress work, or null when it is not In progress or saw an update inside the window. */
export async function idleInProgress(bugId: string, db: Db = prisma, now = Date.now()): Promise<IdleInProgress | null> {
  const work = await inProgressWork(db, bugId);
  if (!work) return null;
  const { abandonCheckMinutes } = await workflowFor(work.bug.projectId, db);
  if (!work.lastUpdate || !isIdle(work.lastUpdate, abandonCheckMinutes, now)) return null;
  return { ...work, lastUpdate: work.lastUpdate, windowMinutes: abandonCheckMinutes };
}

/** Every idle In progress issue in a project, oldest update first. */
export async function findIdleInProgress(
  organisationId: string,
  projectId: string,
  db: Db = prisma,
  now = Date.now(),
  track: WorkTrack = "product",
): Promise<(IdleInProgress & { number: number; title: string; pullRequestUrl: string | null })[]> {
  const candidates = await db.bug.findMany({
    where: { organisationId, projectId, ...trackFilter(track), isDeleted: false, status: "in_progress" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, number: true, title: true, pullRequestUrl: true },
  });
  const idle: (IdleInProgress & { number: number; title: string; pullRequestUrl: string | null })[] = [];
  for (const candidate of candidates) {
    const found = await idleInProgress(candidate.id, db, now);
    // A paused agent can't post updates; its owner resumes it, nobody checks on it meanwhile.
    if (found && !found.claim?.agent.pausedAt) idle.push({ ...found, number: candidate.number, title: candidate.title, pullRequestUrl: candidate.pullRequestUrl });
  }
  return idle.sort((a, b) => a.lastUpdate.getTime() - b.lastUpdate.getTime());
}
