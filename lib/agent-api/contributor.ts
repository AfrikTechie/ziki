import { PRODUCT_TRACK, trackFilter } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { liveHoldWhere } from "@/lib/issue-holders";
import { openIssueConfirmations, type ConfirmationState } from "@/lib/issue-stage";
import { workflowFor } from "@/lib/workflow";
import type { WorkTrack } from "@prisma/client";

export type ClaimableIssue = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  voteCount: number;
  createdAt: Date;
};

/**
 * Scan for unassigned issues that are ready to be worked on.
 *
 * Ordered oldest first, so older issues are picked up first. An unassigned
 * issue whose earlier awards were released, or whose offer expired, is free
 * again (#bids-only-offers). Readiness comes from one bulk read (`openIssueConfirmations`), so the
 * database returns only ready rows and `limit` is never eaten by unconfirmed
 * ones (#714). Pass `confirmations` to reuse a read the caller already made.
 */
export async function findClaimableIssues(
  agent: AgentContext,
  projectId: string,
  confirmations?: Map<string, ConfirmationState>,
  track: WorkTrack = "product",
): Promise<ClaimableIssue[]> {
  requireLevel(agent, "working");
  const workflow = await workflowFor(projectId);

  if (track === "marketing") {
    // Marketing issues are ready as soon as they are open (no confirmation step).
    return prisma.bug.findMany({
      where: {
        tenantId: agent.tenantId,
        projectId,
        ...trackFilter(track),
        status: "open",
        substatus: "open",
        claims: { none: liveHoldWhere(workflow.offerWindowSeconds) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        number: true,
        title: true,
        projectId: true,
        voteCount: true,
        createdAt: true,
      },
    });
  }

  const stages = confirmations ?? await openIssueConfirmations(prisma, { ...PRODUCT_TRACK, tenantId: agent.tenantId, projectId });
  const readyIds = [...stages].filter(([, confirmation]) => confirmation.stage === "ready").map(([id]) => id);
  if (readyIds.length === 0) return [];

  return prisma.bug.findMany({
    where: {
      id: { in: readyIds },
      tenantId: agent.tenantId,
      projectId,
      ...PRODUCT_TRACK,
      // Nothing holds it (liveHoldWhere); a stale assignee does not (#stale-assignee).
      claims: { none: liveHoldWhere(workflow.offerWindowSeconds) },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      number: true,
      title: true,
      projectId: true,
      voteCount: true,
      createdAt: true,
    },
  });
}
