import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { deliveryWindowMinutes, extendDeadline, isDeliveryOverdue } from "@/lib/claim-deadline";
import { workflowFor } from "@/lib/workflow";
import { parseIssueRef, resolveIssueRef } from "@/lib/issue-ref";

const id = z.string().trim().min(1).max(191);

export const extendSchema = z.object({
  projectId: id.optional(),
  /** Why the agent needs more time; required and shown in the audit log. */
  reason: z.string().trim().min(1).max(500),
}).strict();

/**
 * Spend a claim's one extension (#593). The deadline moves by the same window;
 * the heartbeat does not change it. A second request is a 409, as is asking
 * after the deadline has passed or after a fix is already linked.
 */
export async function extendClaim(agent: AgentContext, projectId: string, issueRef: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    // #604: the path may be the readable number (`123`, `ZE-123`) or the id, as on reads.
    const ref = parseIssueRef(issueRef);
    const bugId = ref.kind === "id" ? ref.id : (await resolveIssueRef(tx, ref, { organisationId: agent.organisationId }))?.id;
    if (!bugId) throw new IssueApiError(404, "Issue not found in this project.");
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Bug" WHERE "id" = ${bugId} AND "organisationId" = ${agent.organisationId}
      AND "projectId" = ${projectId} AND "isDeleted" = false FOR NO KEY UPDATE`;
    if (!locked.length) throw new IssueApiError(404, "Issue not found in this project.");

    const claim = await tx.issueClaim.findFirst({
      where: { bugId, agentId: agent.agentId, status: "active", releasedAt: null },
      select: {
        id: true,
        deliverBy: true,
        extendedAt: true,
        bug: { select: { projectId: true, pullRequestUrl: true } },
      },
    });
    if (!claim) throw new IssueApiError(409, "This agent holds no active claim on this issue.");
    if (claim.bug.pullRequestUrl) {
      throw new IssueApiError(409, "A fix is already linked to this issue; no extension is needed.");
    }
    if (claim.extendedAt) throw new IssueApiError(409, "This claim has already used its one extension.");
    if (!claim.deliverBy) throw new IssueApiError(409, "This claim has no delivery deadline.");
    const now = new Date();
    if (isDeliveryOverdue(claim.deliverBy, now)) {
      throw new IssueApiError(409, "The delivery deadline has passed.");
    }

    const { deliveryMinutes } = await workflowFor(claim.bug.projectId, tx);
    const minutes = deliveryWindowMinutes(deliveryMinutes);
    const deliverBy = extendDeadline(claim.deliverBy, minutes);

    await tx.issueClaim.update({
      where: { id: claim.id },
      data: { deliverBy, extendedAt: now, extensionReason: reason },
    });
    await publish(tx, {
      organisationId: agent.organisationId,
      type: "claim.extended",
      actorAgentId: agent.agentId,
      bugId,
      payload: {
        claimId: claim.id,
        issueId: bugId,
        projectId,
        deliverBy: deliverBy.toISOString(),
        reason,
      },
    });

    return { claimId: claim.id, issueId: bugId, deliverBy, extendedAt: now, reason };
  });
}
