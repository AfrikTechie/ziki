import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { activeIn } from "@/lib/agents/active-in";
import { issueHref } from "@/lib/issue-ref";
import { prisma } from "@/lib/prisma";
import {
  DROPPED_RELEASE_REASONS,
  summarizeBidderRecord,
  type BidderAgentInfo,
  type BidderOutcomeEvent,
  type BidderRecordView,
} from "@/lib/bidder-record";

type Db = PrismaClient | Prisma.TransactionClient;

export type BidderRecordScope = {
  organisationId: string;
  areaId: string | null;
  areaName: string | null;
};

export async function bidderRecordsForBids(
  scope: BidderRecordScope,
  bids: Array<{ beneficiaryUserId: string }>,
  db: Db = prisma,
): Promise<Map<string, BidderRecordView>> {
  const userIds = [...new Set(bids.map((bid) => bid.beneficiaryUserId))];
  const records = new Map<string, BidderRecordView>();
  if (userIds.length === 0) return records;

  const [finished, dropped, agents] = await Promise.all([
    db.pointEntry.findMany({
      where: {
        organisationId: scope.organisationId,
        userId: { in: userIds },
        role: "solver",
        points: { gt: 0 },
        correctedAt: null,
        bugId: { not: null },
        sourceKey: { not: { startsWith: "multiplier:" } },
      },
      select: {
        userId: true,
        agentId: true,
        createdAt: true,
        bug: {
          select: {
            id: true,
            number: true,
            title: true,
            organisationId: true,
            areaId: true,
            isDeleted: true,
            project: { select: { slug: true, organisation: { select: { slug: true } } } },
          },
        },
      },
    }),
    db.issueClaim.findMany({
      where: {
        beneficiaryUserId: { in: userIds },
        status: "released",
        releasedAt: { not: null },
        releaseReason: { in: [...DROPPED_RELEASE_REASONS] },
        bug: { organisationId: scope.organisationId, isDeleted: false },
      },
      select: {
        beneficiaryUserId: true,
        agentId: true,
        releasedAt: true,
        bug: {
          select: {
            id: true,
            number: true,
            title: true,
            areaId: true,
            project: { select: { slug: true, organisation: { select: { slug: true } } } },
          },
        },
      },
    }),
    db.agent.findMany({
      where: { ...activeIn(scope.organisationId), ownerUserId: { in: userIds }, revokedAt: null },
      select: { id: true, ownerUserId: true, name: true, username: true },
    }),
  ]);

  const events = new Map<string, BidderOutcomeEvent[]>(userIds.map((id) => [id, []]));
  const agentsByUser = new Map<string, BidderAgentInfo[]>(userIds.map((id) => [id, []]));

  for (const point of finished) {
    if (!point.bug || point.bug.isDeleted || point.bug.organisationId !== scope.organisationId) continue;
    events.get(point.userId)?.push({
      issueId: point.bug.id,
      issueNumber: point.bug.number,
      title: point.bug.title,
      path: issueHref(point.bug),
      outcome: "finished",
      at: point.createdAt,
      areaId: point.bug.areaId,
      agentId: point.agentId,
    });
  }

  for (const claim of dropped) {
    if (!claim.releasedAt) continue;
    events.get(claim.beneficiaryUserId)?.push({
      issueId: claim.bug.id,
      issueNumber: claim.bug.number,
      title: claim.bug.title,
      path: issueHref(claim.bug),
      outcome: "dropped",
      at: claim.releasedAt,
      areaId: claim.bug.areaId,
      agentId: claim.agentId,
    });
  }

  for (const agent of agents) {
    agentsByUser.get(agent.ownerUserId)?.push({ id: agent.id, name: agent.name, username: agent.username });
  }

  const area = scope.areaId ? { id: scope.areaId, name: scope.areaName ?? "this area" } : null;
  for (const userId of userIds) {
    records.set(userId, summarizeBidderRecord(events.get(userId) ?? [], agentsByUser.get(userId) ?? [], area));
  }
  return records;
}
