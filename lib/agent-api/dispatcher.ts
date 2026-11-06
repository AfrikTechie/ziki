import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { isConfirmed } from "@/lib/agent-api/confirmations";
import { workflowFor } from "@/lib/workflow";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { liveHoldWhere } from "@/lib/issue-holders";

/**
 * The dispatcher's read side (#bids-only-offers). Nothing here hands work
 * out: an issue is offered only when an agent awards one of its bids once its
 * votes reach the threshold (`POST /api/v1/bids/{id}/award`). This reports what is waiting.
 */

/**
 * A ready issue: open, confirmed, and with no active claim or live offer.
 */
export type ReadyIssue = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  areaId: string | null;
  voteCount: number;
  assigneeId: string | null;
  createdAt: Date;
};

export const MAX_READY_ISSUES_LIMIT = 500;

/**
 * Scan for ready issues in a project.
 */
export async function findReadyIssues(
  agent: AgentContext,
  projectId: string,
  limit = 50,
): Promise<ReadyIssue[]> {
  requireLevel(agent, "manager");

  const safeLimit = Number.isFinite(limit) && limit > 0
    ? Math.min(Math.floor(limit), MAX_READY_ISSUES_LIMIT)
    : 50;

  const workflow = await workflowFor(projectId);

  const ready: ReadyIssue[] = [];
  let cursor: string | undefined;
  while (ready.length < safeLimit) {
    const issues = await prisma.bug.findMany({
      where: {
        tenantId: agent.tenantId,
        projectId,
        ...PRODUCT_TRACK,
        isDeleted: false,
        substatus: "open",
        claims: { none: liveHoldWhere(workflow.offerWindowSeconds) },
      },
      select: {
        id: true,
        number: true,
        title: true,
        projectId: true,
        areaId: true,
        voteCount: true,
        assigneeId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Filter to only confirmed issues
    for (let offset = 0; offset < issues.length && ready.length < safeLimit; offset += 10) {
      const confirmed = await Promise.all(
        issues.slice(offset, offset + 10).map(async (issue) => ({
          ...issue,
          confirmed: await isConfirmed(issue.id),
        }))
      );
      ready.push(...confirmed.filter((issue) => issue.confirmed));
    }
    if (issues.length < 50) break;
    cursor = issues[issues.length - 1].id;
  }

  return ready.slice(0, safeLimit);
}

/**
 * Get dispatcher metrics for a project.
 */
export async function getDispatcherMetrics(
  agent: AgentContext,
  projectId: string
): Promise<{
  readyIssues: number;
  activeClaims: number;
  pendingOffers: number;
  openBids: number;
}> {
  requireLevel(agent, "manager");

  const workflow = await workflowFor(projectId);
  const offerCutoff = new Date(Date.now() - workflow.offerWindowSeconds * 1000);

  const [readyCount, activeClaims, pendingOffers, openBids] = await Promise.all([
    findReadyIssues(agent, projectId, 100).then((issues) => issues.length),
    prisma.issueClaim.count({
      where: {
        bug: { tenantId: agent.tenantId, projectId },
        status: "active",
        releasedAt: null,
      },
    }),
    prisma.issueClaim.count({
      where: {
        bug: { tenantId: agent.tenantId, projectId },
        status: "offered",
        releasedAt: null,
        offeredAt: { gt: offerCutoff },
      },
    }),
    prisma.issueBid.count({
      where: {
        bug: { tenantId: agent.tenantId, projectId },
        ...OPEN_BID_WHERE,
      },
    }),
  ]);

  return {
    readyIssues: readyCount,
    activeClaims,
    pendingOffers,
    openBids,
  };
}
