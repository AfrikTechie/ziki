import type { AgentLevel, Prisma, PrismaClient } from "@prisma/client";
import { issueHref } from "@/lib/issue-ref";

type Db = PrismaClient | Prisma.TransactionClient;

export const TEAM_ONLINE_WINDOW_MS = 15 * 60 * 1000;
export const TEAM_METRIC_WINDOW_DAYS = 30;

export type TeamAgentWork = {
  id: string;
  /** The issue's address, `/<org>/<project>/<number>`. */
  path: string;
  title: string;
  /** The project area (#609) the issue is in, which the Team page filters on. */
  areaId: string | null;
  areaName: string | null;
};

export type TeamAgent = {
  id: string;
  name: string;
  model: string | null;
  level: AgentLevel;
  online: boolean;
  acceptedFixes: number;
  currentWork: TeamAgentWork[];
};

export function teamMetricSince(now = new Date()): Date {
  return new Date(now.getTime() - TEAM_METRIC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function isTeamAgentOnline(lastSeen: Date | null, now = new Date()): boolean {
  return lastSeen !== null && now.getTime() - lastSeen.getTime() < TEAM_ONLINE_WINDOW_MS;
}

export async function teamAgentsForMembers(
  db: Db,
  tenantId: string,
  ownerUserIds: string[],
  now = new Date(),
): Promise<Map<string, TeamAgent[]>> {
  const result = new Map(ownerUserIds.map((ownerUserId) => [ownerUserId, [] as TeamAgent[]]));
  if (ownerUserIds.length === 0) return result;

  const agents = await db.agent.findMany({
    where: { tenantId, ownerUserId: { in: ownerUserIds }, revokedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      ownerUserId: true,
      name: true,
      model: true,
      level: true,
      // #1123: any authenticated request counts as being seen, not only a
      // claim heartbeat. requireAgent stamps lastUsedAt, at most once a minute.
      apiKeys: { where: { revokedAt: null }, select: { lastUsedAt: true } },
      claims: {
        where: {
          status: "active",
          releasedAt: null,
          bug: { tenantId, isDeleted: false, status: "in_progress" },
        },
        select: {
          claimedAt: true,
          lastHeartbeatAt: true,
          bug: {
            select: {
              id: true,
              number: true,
              project: { select: { slug: true, tenant: { select: { slug: true } } } },
              title: true,
              areaId: true,
              area: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (agents.length === 0) return result;

  const fixedClaims = await db.issueClaim.findMany({
    where: {
      agentId: { in: agents.map((agent) => agent.id) },
      status: "released",
      releasedAt: { not: null },
      releaseReason: "resolved",
      bug: {
        tenantId,
        pointEntries: {
          some: {
            tenantId,
            role: "solver",
            points: { gt: 0 },
            correctedAt: null,
            createdAt: { gte: teamMetricSince(now) },
          },
        },
      },
    },
    select: { agentId: true, bugId: true },
  });
  const fixesByAgent = new Map<string, Set<string>>();
  for (const claim of fixedClaims) {
    const issues = fixesByAgent.get(claim.agentId) ?? new Set<string>();
    issues.add(claim.bugId);
    fixesByAgent.set(claim.agentId, issues);
  }

  for (const agent of agents) {
    const currentWork = agent.claims.map(({ bug }) => ({
      id: bug.id,
      path: issueHref(bug),
      title: bug.title,
      areaId: bug.areaId ?? null,
      areaName: bug.area?.name ?? null,
    }));
    const seenTimes = [
      ...agent.apiKeys.map((key) => key.lastUsedAt),
      ...agent.claims.map((claim) => claim.lastHeartbeatAt ?? claim.claimedAt),
    ];
    const lastSeen = seenTimes.reduce<Date | null>(
      (latest, seen) => (seen && (!latest || seen > latest) ? seen : latest),
      null,
    );
    const memberAgents = result.get(agent.ownerUserId);
    memberAgents?.push({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      level: agent.level,
      online: isTeamAgentOnline(lastSeen, now),
      acceptedFixes: fixesByAgent.get(agent.id)?.size ?? 0,
      currentWork,
    });
  }
  return result;
}

export async function teamAgentsForMember(
  db: Db,
  tenantId: string,
  ownerUserId: string,
  now = new Date(),
): Promise<TeamAgent[]> {
  const agents = await teamAgentsForMembers(db, tenantId, [ownerUserId], now);
  return agents.get(ownerUserId) ?? [];
}

/**
 * Ziki #447: issues assigned to a person that none of their agents has
 * claimed. An assignment is to the person, not to one of their agents, so
 * this is shown once at member level and never put on an agent's card: with
 * several agents there is no truthful way to say which one is doing it.
 *
 * Counted: open or in_progress, not deleted, in this tenant. An issue already
 * on one of the person's agent cards (an active claim) is left out here, so a
 * claimed and assigned issue counts once.
 */
export async function teamAssignedWorkForMembers(
  db: Db,
  tenantId: string,
  agentsByOwner: Map<string, TeamAgent[]>,
): Promise<Map<string, TeamAgentWork[]>> {
  const ownerUserIds = [...agentsByOwner.keys()];
  const result = new Map(ownerUserIds.map((ownerUserId) => [ownerUserId, [] as TeamAgentWork[]]));
  if (ownerUserIds.length === 0) return result;

  const bugs = await db.bug.findMany({
    where: { tenantId, isDeleted: false, status: { in: ["open", "in_progress"] }, assigneeId: { in: ownerUserIds } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      number: true,
      project: { select: { slug: true, tenant: { select: { slug: true } } } },
      title: true,
      assigneeId: true,
      areaId: true,
      area: { select: { name: true } },
    },
  });
  for (const bug of bugs) {
    if (!bug.assigneeId) continue;
    const onAgentCard = (agentsByOwner.get(bug.assigneeId) ?? []).some((agent) =>
      agent.currentWork.some((work) => work.id === bug.id),
    );
    if (onAgentCard) continue;
    result.get(bug.assigneeId)?.push({
      id: bug.id,
      path: issueHref(bug),
      title: bug.title,
      areaId: bug.areaId ?? null,
      areaName: bug.area?.name ?? null,
    });
  }
  return result;
}

export async function teamAssignedWorkForMember(
  db: Db,
  tenantId: string,
  ownerUserId: string,
  agents: TeamAgent[],
): Promise<TeamAgentWork[]> {
  const work = await teamAssignedWorkForMembers(db, tenantId, new Map([[ownerUserId, agents]]));
  return work.get(ownerUserId) ?? [];
}
