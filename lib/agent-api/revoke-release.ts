import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/agents/audit";
import { publish } from "@/lib/agent-api/events";
import { moveTo } from "@/lib/issue-substatus";

/**
 * Hands back the work of an agent that is being revoked (#523).
 *
 * A revoked key can't heartbeat or deliver, so its open claims would hold
 * their issues forever. Inside the revoke transaction this:
 * - releases every offered or active claim with `releaseReason: "revoked"`;
 * - reopens the issue when this was its only open claim, the same way the
 *   silence release does (a person's later reassignment or resolution is kept);
 * - withdraws the agent's bids that were never awarded;
 * - publishes `claim.released` and writes an audit row per claim.
 * The released issues wait in Open for bids; nobody is offered them in turn.
 */
export async function releaseWorkOfRevokedAgent(
  tx: Prisma.TransactionClient,
  input: { agentId: string; organisationId: string; actorUserId: string; now: Date },
): Promise<{
  releasedClaims: number;
  withdrawnBids: number;
}> {
  const { agentId, organisationId, actorUserId, now } = input;
  const open = await tx.issueClaim.findMany({
    where: { agentId, releasedAt: null, status: { in: ["offered", "planning", "active"] } },
    select: { id: true, bugId: true },
    orderBy: { bugId: "asc" },
  });

  let releasedClaims = 0;
  for (const candidate of open) {
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${candidate.bugId} FOR NO KEY UPDATE`;
    // Re-read after locking: an expiry or another release may have won the race.
    const claim = await tx.issueClaim.findFirst({
      where: { id: candidate.id, releasedAt: null, status: { in: ["offered", "planning", "active"] } },
      select: { id: true, bugId: true, status: true, beneficiaryUserId: true },
    });
    if (!claim) continue;
    await tx.issueClaim.update({
      where: { id: claim.id },
      data: { status: "released", releasedAt: now, releaseReason: "revoked" },
    });
    const otherOpen = await tx.issueClaim.count({
      where: { bugId: claim.bugId, releasedAt: null, id: { not: claim.id } },
    });
    if (!otherOpen && claim.status === "active") {
      await tx.bug.updateMany({
        // A delivered fix stays where it got to (#one-status).
        where: { id: claim.bugId, organisationId, isDeleted: false, assigneeId: claim.beneficiaryUserId, status: "in_progress", pullRequestUrl: null },
        data: { assigneeId: null, ...moveTo("open") },
      });
    }
    // A plan under review goes with the claim (#plan-review): the issue is Open for bids again.
    if (!otherOpen && claim.status === "planning") {
      await tx.bug.updateMany({ where: { id: claim.bugId, organisationId, isDeleted: false, substatus: "plan_review" }, data: { assigneeId: null, ...moveTo("open") } });
    }
    await publish(tx, {
      organisationId,
      type: "claim.released",
      actorAgentId: agentId,
      bugId: claim.bugId,
      payload: { claimId: claim.id, issueId: claim.bugId, beneficiaryUserId: claim.beneficiaryUserId, reason: "revoked" },
    });
    await audit({ agentId, organisationId }, "claim.released", claim.bugId, { claimId: claim.id, reason: "revoked" }, {
      db: tx,
      bugId: claim.bugId,
      actorUserId,
    });
    releasedClaims++;
  }

  const withdrawn = await tx.issueBid.updateMany({
    where: { agentId, withdrawnAt: null, awardedAt: null },
    data: { withdrawnAt: now },
  });

  return { releasedClaims, withdrawnBids: withdrawn.count };
}
