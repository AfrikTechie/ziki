import { prisma } from "@/lib/prisma";
import { isDeliveryOverdue } from "@/lib/claim-deadline";
import { workflowFor } from "@/lib/workflow";

/**
 * What makes an issue's hold stale (#reclaim): an offer nobody accepted within
 * the project's offer window, or work not delivered by its deadline or gone
 * silent past the heartbeat window, with no pull request linked.
 */
export type StaleHold = { claimId: string; kind: "offer_expired" | "overdue" | "silent" };

export async function staleHold(bugId: string, now = new Date()): Promise<StaleHold | null> {
  const claim = await prisma.issueClaim.findFirst({
    where: { bugId, releasedAt: null, status: { in: ["offered", "planning", "active"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, status: true, offeredAt: true, claimedAt: true, lastHeartbeatAt: true, deliverBy: true, waitingOnOwnerSince: true,
      agent: { select: { pausedAt: true } },
      bug: { select: { projectId: true, pullRequestUrl: true, status: true } },
    },
  });
  if (!claim) return null;
  const workflow = await workflowFor(claim.bug.projectId);
  // A planning claim (#plan-review) is released by the plan sweeper when its window runs out, not reclaimed.
  if (claim.status === "planning") return null;
  if (claim.status === "offered") {
    const lapsed = claim.offeredAt !== null && now.getTime() - claim.offeredAt.getTime() >= workflow.offerWindowSeconds * 1000;
    return lapsed ? { claimId: claim.id, kind: "offer_expired" } : null;
  }
  if (claim.bug.status !== "in_progress" || claim.bug.pullRequestUrl || claim.waitingOnOwnerSince || claim.agent.pausedAt) return null;
  if (isDeliveryOverdue(claim.deliverBy, now)) return { claimId: claim.id, kind: "overdue" };
  const lastSeen = claim.lastHeartbeatAt ?? claim.claimedAt;
  if (lastSeen && lastSeen.getTime() < now.getTime() - workflow.heartbeatMinutes * 60_000) return { claimId: claim.id, kind: "silent" };
  return null;
}
