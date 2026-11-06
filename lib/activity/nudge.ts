import "server-only";
import { prisma } from "@/lib/prisma";
import { sendAgentMessage } from "@/lib/agent-messages";
import { workflowFor } from "@/lib/workflow";
import type { Actor } from "@/lib/agents/registry";
import { nudgeMessage } from "@/lib/activity/board";

export type NudgeResult = { ok: true; at: string } | { ok: false; error: string };

/**
 * Nudge the agent holding a live offer or claim (#849). It goes out as an
 * ordinary message (lib/agent-messages.ts), so the same rule decides who may
 * send it: the agent's owner, or an admin of its organisation.
 */
export async function nudgeClaimAgent(actor: Actor & { name?: string | null }, claimId: string): Promise<NudgeResult> {
  const claim = await prisma.issueClaim.findUnique({
    where: { id: claimId },
    select: {
      status: true,
      releasedAt: true,
      offeredAt: true,
      createdAt: true,
      deliverBy: true,
      agentId: true,
      bug: { select: { number: true, title: true, projectId: true, isDeleted: true } },
    },
  });
  if (!claim || claim.bug.isDeleted) return { ok: false, error: "That claim doesn't exist." };
  if (claim.releasedAt || claim.status === "released") return { ok: false, error: "That claim has already ended." };

  const { offerWindowSeconds } = await workflowFor(claim.bug.projectId);
  const offeredAt = claim.offeredAt ?? claim.createdAt;
  const body = nudgeMessage(
    {
      status: claim.status,
      issueNumber: claim.bug.number,
      issueTitle: claim.bug.title,
      offerExpiresAt: claim.status === "offered" ? new Date(offeredAt.getTime() + offerWindowSeconds * 1000) : null,
      deliverBy: claim.deliverBy,
    },
    actor.name?.trim() || "your owner",
  );
  const sent = await sendAgentMessage(actor, claim.agentId, { body });
  return sent.ok ? { ok: true, at: new Date().toISOString() } : sent;
}
