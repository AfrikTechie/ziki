import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertKeyProject, type AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { entrySummary } from "@/lib/agent-api/entry-fields";
import { statusChangedSummary } from "@/lib/activity-log";
import { parseIssueRef, resolveIssueRef } from "@/lib/issue-ref";
import { workflowFor } from "@/lib/workflow";
import { voteWeight } from "@/lib/governance";
import { idleInProgress, inProgressWork, isIdle } from "@/lib/agent-api/idle";
import { moveTo } from "@/lib/issue-substatus";
import { notifyLater } from "@/lib/notify";

/**
 * Sense checks on stale in-progress work (#abandon). When held work is idle
 * (lib/agent-api/idle.ts: no update for the project's `abandonCheckMinutes`,
 * 2 hours by default), every other agent's work feed asks it to check. Each
 * person, through their agent, may vote that it is abandoned: one vote per person per claim, a manager (or
 * merger) agent's counting the project's `managerVoteWeight` (lib/governance.ts).
 * Once the claim's votes reach `abandonThreshold`, in either governance mode,
 * the claim is released, its award no longer stands, and the issue goes back
 * to Open with no assignee.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export const abandonVoteSchema = z.object({ summary: entrySummary }).strict();

/** The Abandoned votes on a claim, added up. */
export async function abandonTally(claimId: string, db: Db = prisma): Promise<{ votes: number; voters: string[] }> {
  const rows = await db.abandonVote.findMany({ where: { claimId }, select: { votes: true, onBehalfOfUserId: true } });
  return { votes: rows.reduce((sum, row) => sum + row.votes, 0), voters: rows.map((row) => row.onBehalfOfUserId) };
}

/** The sense check an issue page shows: due, and the votes so far. Null when nothing is due. */
export async function senseCheck(bugId: string, now = Date.now()) {
  const idle = await idleInProgress(bugId, prisma, now);
  // Idle work nobody holds is a manager's review_idle, not a vote.
  if (!idle?.claim) return null;
  const { abandonThreshold, managerVoteWeight } = await workflowFor(idle.bug.projectId);
  const { votes } = await abandonTally(idle.claim.id);
  return { claimId: idle.claim.id, lastUpdate: idle.lastUpdate, votes, threshold: abandonThreshold, managerVoteWeight };
}

/**
 * `POST /api/v1/issues/{id}/abandon-votes` (#abandon): vote that the held work
 * is abandoned. Refused while the sense check is not due (409 not_due), on an
 * issue nobody is working on (409), and for the holder's own owner (403). A
 * newer vote from the same person replaces theirs.
 */
export async function voteAbandoned(agent: AgentContext, projectId: string, issueRef: string, input: z.infer<typeof abandonVoteSchema>) {
  requireLevel(agent, "working");
  assertKeyProject(agent, projectId);
  const resolved = await resolveIssueRef(prisma, parseIssueRef(issueRef), { organisationId: agent.organisationId });
  const bug = resolved && await prisma.bug.findFirst({
    where: { id: resolved.id, organisationId: agent.organisationId, projectId, isDeleted: false },
    select: { id: true, number: true, title: true, reporterId: true },
  });
  if (!bug) throw new IssueApiError(404, "Issue not found in this project.");
  const workflow = await workflowFor(projectId);
  const weight = voteWeight(agent.level, workflow.managerVoteWeight);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${bug.id} FOR UPDATE`;
    const held = await inProgressWork(tx, bug.id);
    const claim = held?.claim;
    if (!held || !claim) {
      const message = held
        ? "Nobody holds this issue, so there is no claim to vote on; a manager agent takes idle work nobody holds back to Open with POST /api/v1/issues/{id}/reclaim."
        : "Nobody is working on this issue, so there is nothing to check.";
      throw new IssueApiError(409, message, { error: "not_in_progress" });
    }
    if (agent.ownerId === claim.beneficiaryUserId || agent.ownerId === claim.agent.ownerUserId) {
      throw new IssueApiError(403, "This is your owner's own work; another agent checks it.", { error: "own_work" });
    }
    if (claim.agent.pausedAt) {
      const message = "Its owner has paused this agent, so its claim is held until they resume it.";
      throw new IssueApiError(409, message, { error: "agent_paused", message });
    }
    if (!isIdle(held.lastUpdate, workflow.abandonCheckMinutes)) {
      const message = `This work was updated less than ${workflow.abandonCheckMinutes} minutes ago; it is not up for a sense check yet.`;
      throw new IssueApiError(409, message, { error: "not_due", message });
    }
    // One vote per person, at the highest weight any of their agents cast.
    const earlier = await tx.abandonVote.findUnique({
      where: { claimId_onBehalfOfUserId: { claimId: claim.id, onBehalfOfUserId: agent.ownerId } },
      select: { votes: true },
    });
    await tx.abandonVote.upsert({
      where: { claimId_onBehalfOfUserId: { claimId: claim.id, onBehalfOfUserId: agent.ownerId } },
      update: { votes: Math.max(weight, earlier?.votes ?? 0), summary: input.summary, agentId: agent.agentId },
      create: { claimId: claim.id, bugId: bug.id, onBehalfOfUserId: agent.ownerId, agentId: agent.agentId, votes: weight, summary: input.summary },
    });
    const { votes } = await abandonTally(claim.id, tx);
    await publish(tx, {
      organisationId: agent.organisationId,
      type: "issue.abandon_voted",
      actorAgentId: agent.agentId,
      bugId: bug.id,
      projectId,
      payload: { issueId: bug.id, issueNumber: bug.number, claimId: claim.id, votes, threshold: workflow.abandonThreshold },
    });
    const abandoned = votes >= workflow.abandonThreshold;
    if (abandoned) {
      const now = new Date();
      await tx.issueClaim.update({ where: { id: claim.id }, data: { status: "released", releasedAt: now, releaseReason: "abandoned" } });
      await tx.bug.update({ where: { id: bug.id }, data: { ...moveTo("open"), assigneeId: null } });
      await tx.bugActivity.create({
        data: {
          bugId: bug.id,
          actorId: agent.ownerId,
          type: "status_changed",
          summary: statusChangedSummary("in_progress", "open"),
          metadata: { field: "status", from: "in_progress", to: "open", via: "abandoned", votes },
        },
      });
      await publish(tx, {
        organisationId: agent.organisationId,
        type: "claim.released",
        actorAgentId: claim.agentId,
        bugId: bug.id,
        projectId,
        payload: { claimId: claim.id, issueId: bug.id, projectId, beneficiaryUserId: claim.beneficiaryUserId, reason: "abandoned" },
      });
    }
    return { issueId: bug.id, issueNumber: bug.number, claimId: claim.id, votes, threshold: workflow.abandonThreshold, abandoned, status: abandoned ? "open" : "in_progress" };
  });
  await audit(agent, "issue.abandon_voted", `issue:${bug.id}`, { claimId: result.claimId, votes: result.votes, abandoned: result.abandoned }, { bugId: bug.id });
  if (result.abandoned) {
    notifyLater({
      kind: "status_changed",
      actorId: agent.ownerId,
      actorName: agent.name,
      bugId: bug.id,
      bugTitle: bug.title,
      reporterId: bug.reporterId,
      from: "in_progress",
      to: "open",
    });
  }
  return result;
}
