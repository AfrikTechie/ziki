import type { Prisma, PrismaClient } from "@prisma/client";
import { pointsNumber } from "@/lib/points/rules";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Lifetime points each agent earned in a organisation (#710): the sum of the point
 * entries its work wrote, corrections included (they carry the same agent).
 * Every entry is confirmed: Ziki writes points only once the work is
 * accepted, so there is no pending amount. Entries a person earned with no
 * agent, and entries written before agents were recorded, belong to no agent.
 * An agent with none is 0.
 */
export async function agentEarnings(db: Db, organisationId: string, agentIds: string[]): Promise<Map<string, number>> {
  const earned = new Map<string, number>(agentIds.map((id) => [id, 0]));
  if (!agentIds.length) return earned;
  const rows = await db.pointEntry.groupBy({
    by: ["agentId"],
    where: { organisationId, agentId: { in: agentIds } },
    _sum: { points: true },
  });
  for (const row of rows) if (row.agentId) earned.set(row.agentId, pointsNumber(row._sum.points));
  return earned;
}

/** What each agent has done, for the agents bar (#agents-dock): bids placed, comments written, points earned today. */
export type AgentActivity = { bids: number; comments: number; pointsToday: number };

/**
 * Each agent's bids (all time), comments (not deleted) and the points its work
 * earned since `since` (the start of today, server time).
 */
export async function agentActivity(db: Db, organisationId: string, agentIds: string[], since: Date): Promise<Map<string, AgentActivity>> {
  const stats = new Map<string, AgentActivity>(agentIds.map((id) => [id, { bids: 0, comments: 0, pointsToday: 0 }]));
  if (!agentIds.length) return stats;
  const [bids, comments, today] = await Promise.all([
    db.issueBid.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds } }, _count: { _all: true } }),
    db.comment.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, deletedAt: null }, _count: { _all: true } }),
    db.pointEntry.groupBy({ by: ["agentId"], where: { organisationId, agentId: { in: agentIds }, createdAt: { gte: since } }, _sum: { points: true } }),
  ]);
  for (const row of bids) if (row.agentId && stats.has(row.agentId)) stats.get(row.agentId)!.bids = row._count._all;
  for (const row of comments) if (row.agentId && stats.has(row.agentId)) stats.get(row.agentId)!.comments = row._count._all;
  for (const row of today) if (row.agentId && stats.has(row.agentId)) stats.get(row.agentId)!.pointsToday = pointsNumber(row._sum.points);
  return stats;
}
