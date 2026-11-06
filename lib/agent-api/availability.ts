import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import type { AgentContext } from "@/lib/agents/require-agent";
import { audit, type AuditAgent } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { notifyAgentQuestion } from "@/lib/agent-notifications";
import { expireOffer } from "@/lib/agent-api/offer";
import { staleHold } from "@/lib/agent-api/stale-hold";
import { idleInProgress } from "@/lib/agent-api/idle";
import { strandedDelivery } from "@/lib/agent-api/stranded-delivery";
import { issueChangePayload } from "@/lib/agent-api/web-events";
import { requireLevel } from "@/lib/agents/levels";
import { reviewerConflict, ReviewerNotIndependentError } from "@/lib/agents/independence";
import { statusChangedSummary } from "@/lib/activity-log";
import { issueIdFor, parseIssueRef, resolveIssueRef } from "@/lib/issue-ref";
import { isDeliveryOverdue, isOwnerWaitOver, ownerWaitCapMinutes, OWNER_REMINDER_MINUTES } from "@/lib/claim-deadline";
import { workflowFor } from "@/lib/workflow";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";
import { moveTo } from "@/lib/issue-substatus";
import { notifyLater } from "@/lib/notify";

function heartbeatCutoff(now: Date, heartbeatMinutes: number): Date {
  return new Date(now.getTime() - heartbeatMinutes * 60_000);
}

/**
 * Claims a sweep should inspect: silent ones (no heartbeat for the project's
 * heartbeat window, 15 minutes by default) and
 * overdue ones (#593) whose fix is not linked yet. Both are released and the
 * issue goes back to Open for bids; the deadline does not depend on the heartbeat. A claim waiting
 * on its owner's answer (#606) is left to `sweepOwnerWaits`.
 */
function claimSweepWhere(
  now: Date,
  cutoff: Date,
  scope: { projectId?: string; projectIds?: string[]; tenantId?: string } = {},
): Prisma.IssueClaimWhereInput {
  return {
    status: "active",
    releasedAt: null,
    waitingOnOwnerSince: null,
    agent: { pausedAt: null },
    bug: {
      isDeleted: false,
      status: "in_progress",
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      ...(scope.projectIds ? { projectId: { in: scope.projectIds } } : {}),
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
    },
    OR: [
      // #551: a claim whose fix is linked is waiting on review, not silent.
      { lastHeartbeatAt: { lt: cutoff }, bug: { pullRequestUrl: null } },
      { lastHeartbeatAt: null, claimedAt: { lt: cutoff }, bug: { pullRequestUrl: null } },
      { deliverBy: { lt: now }, bug: { pullRequestUrl: null } },
    ],
  };
}

export async function heartbeatClaim(agent: AgentContext, projectId: string, issueRef: string) {
  return prisma.$transaction(async (tx) => {
    // #457: the path may be the readable number (`123`, `ZE-123`) or the id.
    const bugId = await issueIdFor(tx, issueRef, agent.tenantId);
    if (!bugId) throw new IssueApiError(404, "Issue not found in this project.");
    // All claim transitions lock the issue first, including the stale-claim sweep.
    const issues = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Bug" WHERE "id" = ${bugId} AND "tenantId" = ${agent.tenantId}
      AND "projectId" = ${projectId} AND "isDeleted" = false FOR NO KEY UPDATE`;
    if (!issues.length) throw new IssueApiError(404, "Issue not found in this project.");
    const agents = await tx.$queryRaw<{ pausedAt: Date | null }[]>`SELECT "pausedAt" FROM "Agent" WHERE "id" = ${agent.agentId} FOR UPDATE`;
    const claim = await tx.issueClaim.findFirst({ where: { bugId, releasedAt: null }, orderBy: { createdAt: "desc" } });
    if (!claim) throw new IssueApiError(409, "This issue has no current claim.");
    if (claim.agentId !== agent.agentId) throw new IssueApiError(403, "Only the claiming agent can send a heartbeat.");
    if (claim.status !== "active") throw new IssueApiError(409, "Only active claims accept heartbeats.");
    if (agents[0]?.pausedAt || agent.pausedAt) return claim;
    return tx.issueClaim.update({ where: { id: claim.id }, data: { lastHeartbeatAt: new Date() } });
  });
}

// ---------------------------------------------------------------------------
// Stale-claim sweep (#524)
// ---------------------------------------------------------------------------

/** Where a released claim lives: the claim plus its bug's tenant and project. */
type StaleClaimRef = { id: string; bugId: string; bug: { tenantId: string; projectId: string } };

type ReleaseOutcome = {
  released: boolean;
  /** True when this release moved the issue back to `open` with no assignee. */
  opened: boolean;
};

/**
 * Release one active claim whose agent stopped heartbeating, atomically:
 * lock the issue, re-read the claim, mark it `released` for `silence`,
 * `deadline`, or `owner_unresponsive` once a wait on its owner is over (#606),
 * publish a `claim.released` event, audit, and reopen the issue when no human
 * assignment or newer claim intervenes. A reopened issue waits in Open for
 * bids; nobody is offered it automatically.
 */
async function releaseClaimIfStale(
  claim: StaleClaimRef,
  cutoff: Date,
  options: { actorUserId?: string | null } = {},
): Promise<ReleaseOutcome> {
  const tenantId = claim.bug.tenantId;
  const projectId = claim.bug.projectId;
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${claim.bugId} FOR NO KEY UPDATE`;
    // Pause/resume and releases serialize on the same agent row. The bug is
    // always locked first by claim transitions; pause/resume never locks it.
    await tx.$queryRaw`SELECT a."id" FROM "Agent" a JOIN "IssueClaim" c ON c."agentId" = a."id" WHERE c."id" = ${claim.id} FOR UPDATE OF a`;
    // Re-read after locking: a heartbeat or another sweep may have won the race.
    const fresh = await tx.issueClaim.findFirst({ where: { id: claim.id, status: "active", releasedAt: null,
      agent: { pausedAt: null }, bug: { projectId, tenantId, isDeleted: false, status: "in_progress" } },
      include: { bug: { select: { pullRequestUrl: true, project: { select: { ownerWaitCapMinutes: true } } } } } });
    const now = new Date();
    if (!fresh) return { released: false, opened: false };
    let reason: "silence" | "deadline" | "owner_unresponsive";
    if (fresh.waitingOnOwnerSince) {
      // #606: the clocks are paused while the agent waits on its owner, up to the cap.
      const cap = ownerWaitCapMinutes(fresh.bug?.project?.ownerWaitCapMinutes);
      if (!isOwnerWaitOver(fresh.waitingOnOwnerSince, now, cap)) return { released: false, opened: false };
      reason = "owner_unresponsive";
    } else {
      const lastSeen = fresh.lastHeartbeatAt ?? fresh.claimedAt;
      // #551: once the fix is linked the agent has delivered; waiting for testers
      // and a merger must not read as silence, or the assignee is cleared.
      const silent = lastSeen != null && lastSeen.getTime() < cutoff.getTime() && !fresh.bug?.pullRequestUrl;
      // #593: an undelivered claim past its deadline goes back even while the
      // agent keeps heartbeating.
      const overdue = isDeliveryOverdue(fresh.deliverBy, now) && !fresh.bug?.pullRequestUrl;
      if (!silent && !overdue) return { released: false, opened: false };
      reason = overdue ? "deadline" : "silence";
    }
    await tx.issueClaim.update({ where: { id: fresh.id }, data: { status: "released", releasedAt: now, releaseReason: reason } });
    await publish(tx, { tenantId, type: "claim.released", actorAgentId: fresh.agentId, bugId: fresh.bugId,
      payload: { claimId: fresh.id, issueId: fresh.bugId, projectId, beneficiaryUserId: fresh.beneficiaryUserId, reason } });
    await audit({ agentId: fresh.agentId, tenantId } satisfies AuditAgent, "claim.released", fresh.bugId,
      { claimId: fresh.id, reason, projectId }, { db: tx, bugId: fresh.bugId, actorUserId: options.actorUserId ?? null });
    const otherClaim = await tx.issueClaim.count({ where: { bugId: fresh.bugId, releasedAt: null, id: { not: fresh.id } } });
    let reopened = false;
    // Preserve a human's later reassignment or resolution and any newer claim.
    // A delivered fix stays where it got to (#one-status).
    if (!otherClaim) {
      const reopenedRow = await tx.bug.updateMany({ where: { id: fresh.bugId, projectId, tenantId,
        isDeleted: false, assigneeId: fresh.beneficiaryUserId, status: "in_progress", pullRequestUrl: null }, data: { assigneeId: null, ...moveTo("open") } });
      reopened = reopenedRow.count > 0;
    }
    return { released: true, opened: reopened };
  });
  if (outcome.opened) {
    const reopenedBug = await prisma.bug.findFirst({
      where: { id: claim.bugId, status: "open", isDeleted: false },
      select: { title: true, reporterId: true },
    });
    if (reopenedBug) {
      notifyLater({
        kind: "status_changed",
        actorId: "ziki-system",
        actorName: "Ziki",
        bugId: claim.bugId,
        bugTitle: reopenedBug.title,
        reporterId: reopenedBug.reporterId,
        from: "in_progress",
        to: "open",
      });
    }
  }
  return outcome;
}

/**
 * Claims paused on an owner's answer (#606). Past the project's cap they are
 * released for `owner_unresponsive`; otherwise the owner is reminded once the
 * oldest open question on the issue is 30 minutes old.
 */
async function sweepOwnerWaits(
  now: Date,
  cutoff: Date,
  scope: { projectId?: string; tenantId?: string } = {},
  options: { actorUserId?: string | null; limit?: number } = {},
) {
  const waiting = await prisma.issueClaim.findMany({
    where: {
      status: "active",
      releasedAt: null,
      waitingOnOwnerSince: { not: null },
      agent: { pausedAt: null },
      bug: {
        isDeleted: false,
        status: "in_progress",
        ...(scope.projectId ? { projectId: scope.projectId } : {}),
        ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      },
    },
    select: { id: true, bugId: true, agentId: true, waitingOnOwnerSince: true,
      bug: { select: { tenantId: true, projectId: true, project: { select: { ownerWaitCapMinutes: true } } } } },
    orderBy: { waitingOnOwnerSince: "asc" },
    ...(options.limit ? { take: options.limit } : {}),
  });
  let released = 0;
  for (const claim of waiting) {
    if (!claim.waitingOnOwnerSince) continue;
    if (isOwnerWaitOver(claim.waitingOnOwnerSince, now, ownerWaitCapMinutes(claim.bug.project?.ownerWaitCapMinutes))) {
      const outcome = await releaseClaimIfStale(claim, cutoff, { actorUserId: options.actorUserId ?? null });
      if (outcome.released) released++;
    } else {
      await remindOwnerIfDue(claim.agentId, claim.bugId, now);
    }
  }
  return { released };
}

/** Remind the owner of the oldest unanswered question on the issue, once. */
async function remindOwnerIfDue(agentId: string, bugId: string, now: Date) {
  const due = new Date(now.getTime() - OWNER_REMINDER_MINUTES * 60_000);
  const question = await prisma.agentQuestion.findFirst({
    where: { agentId, bugId, answeredAt: null, remindedAt: null, createdAt: { lte: due } },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, ownerUserId: true, agent: { select: { name: true, tenantId: true } },
      bug: { select: { title: true } } },
  });
  if (!question) return;
  // Guarded so two sweeps racing send one reminder.
  const marked = await prisma.agentQuestion.updateMany({ where: { id: question.id, remindedAt: null }, data: { remindedAt: now } });
  if (!marked.count) return;
  notifyAgentQuestion({
    id: question.id,
    body: question.body,
    tenantId: question.agent.tenantId,
    ownerUserId: question.ownerUserId,
    agent: { name: question.agent.name },
    bugId,
    bugTitle: question.bug?.title ?? null,
    reminder: true,
  });
}

/**
 * `POST /api/v1/issues/{id}/reclaim` (#reclaim): any working agent asks the
 * site to take back a stale hold. The site checks it itself: an expired offer
 * is released, and undelivered work past its deadline (or silent) is released
 * and the issue goes back to Open. Idle In progress work that nobody holds
 * goes to `reclaimIdleIssue`, for manager agents only (#idle). Anything else
 * is refused (409).
 */
export async function reclaimStaleIssue(agent: AgentContext, projectId: string, issueRef: string) {
  const ref = parseIssueRef(issueRef);
  const bug = await resolveIssueRef(prisma, ref, { tenantId: agent.tenantId });
  const row = bug && await prisma.bug.findFirst({
    where: { id: bug.id, tenantId: agent.tenantId, projectId, isDeleted: false },
    select: { id: true, number: true, tenantId: true, projectId: true },
  });
  if (!row) throw new IssueApiError(404, "Issue not found in this project.");
  const stale = await staleHold(row.id);
  if (!stale) {
    // #idle: In progress work nobody holds, idle past the window, is a manager's call.
    const idle = await idleInProgress(row.id);
    if (idle && !idle.claim) return reclaimIdleIssue(agent, row);
    const message = "Nothing to reclaim: this issue's offer or work is not stale, and it is not idle In progress work that nobody holds.";
    throw new IssueApiError(409, message, { error: "not_stale", message });
  }
  if (stale.kind === "offer_expired") {
    await expireOffer(stale.claimId);
  } else {
    const { heartbeatMinutes } = await workflowFor(row.projectId);
    await releaseClaimIfStale(
      { id: stale.claimId, bugId: row.id, bug: { tenantId: row.tenantId, projectId: row.projectId } },
      heartbeatCutoff(new Date(), heartbeatMinutes),
      { actorUserId: agent.ownerId },
    );
  }
  const after = await prisma.bug.findUnique({ where: { id: row.id }, select: { status: true, substatus: true } });
  return { issueId: row.id, issueNumber: row.number, claimId: stale.claimId, reason: stale.kind, status: after?.status ?? null, substatus: after?.substatus ?? null };
}

/**
 * #idle: a manager agent takes idle In progress work that nobody holds back to
 * Open (lib/agent-api/idle.ts). Any manager (or merger) agent may, the owner's
 * own included (#owner-agents), except the agent holding the claim. A stranded
 * delivery is delivered instead (deliver_stranded), never reclaimed. The issue
 * goes to Open with no assignee, the activity log and an `issue.updated` event
 * record it with the reason `idle`, and the pull request link, if any, stays.
 */
async function reclaimIdleIssue(
  agent: AgentContext,
  row: { id: string; number: number; tenantId: string; projectId: string },
) {
  requireLevel(agent, "manager");
  const reviewed = await prisma.bug.findUnique({
    where: { id: row.id },
    select: {
      reporterId: true,
      beneficiaryUserId: true,
      assigneeId: true,
      createdByAgent: { select: { ownerUserId: true } },
      claims: { select: { status: true, releasedAt: true, beneficiaryUserId: true, agentId: true, dispatcherUserId: true, agent: { select: { ownerUserId: true } } } },
    },
  });
  const conflict = reviewed ? reviewerConflict({ id: agent.agentId, ownerUserId: agent.ownerId }, reviewed) : null;
  if (conflict) {
    const message = new ReviewerNotIndependentError(conflict).message;
    throw new IssueApiError(403, message, { error: "not_independent", message });
  }
  if (await strandedDelivery(row.id)) {
    const message = "Its linked pull request has enough good judgements: deliver it on the holder's behalf instead of reclaiming it.";
    throw new IssueApiError(409, message, { error: "stranded_delivery", message });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${row.id} FOR NO KEY UPDATE`;
    // Re-check after locking: an update, a claim or another manager may have won the race.
    const idle = await idleInProgress(row.id, tx);
    if (!idle || idle.claim) {
      const message = "Nothing to reclaim: this issue is no longer idle In progress work that nobody holds.";
      throw new IssueApiError(409, message, { error: "not_stale", message });
    }
    const bug = await tx.bug.findUnique({ where: { id: row.id }, select: { assigneeId: true } });
    const reopened = await tx.bug.updateMany({
      where: { id: row.id, tenantId: row.tenantId, projectId: row.projectId, isDeleted: false, status: "in_progress" },
      data: { ...moveTo("open"), assigneeId: null },
    });
    if (reopened.count !== 1) {
      const message = "Nothing to reclaim: this issue is no longer In progress.";
      throw new IssueApiError(409, message, { error: "not_stale", message });
    }
    await tx.bugActivity.create({
      data: {
        bugId: row.id,
        actorId: agent.ownerId,
        type: "status_changed",
        summary: statusChangedSummary("in_progress", "open"),
        metadata: { field: "status", from: "in_progress", to: "open", via: "idle", lastUpdate: idle.lastUpdate.toISOString() },
      },
    });
    await publish(tx, {
      tenantId: row.tenantId,
      type: "issue.updated",
      actorAgentId: agent.agentId,
      bugId: row.id,
      projectId: row.projectId,
      payload: {
        issueId: row.id,
        projectId: row.projectId,
        ...issueChangePayload({ ...moveTo("open"), assigneeId: null }),
        reason: "idle",
        previousStatus: "in_progress",
        previousAssigneeId: bug?.assigneeId ?? null,
        lastUpdate: idle.lastUpdate.toISOString(),
      },
    });
    return { lastUpdate: idle.lastUpdate, previousAssigneeId: bug?.assigneeId ?? null };
  });
  await audit(agent, "issue.updated", `issue:${row.id}`, {
    reason: "idle",
    from: "in_progress",
    to: "open",
    previousAssigneeId: result.previousAssigneeId,
    lastUpdate: result.lastUpdate.toISOString(),
  }, { bugId: row.id });
  return { issueId: row.id, issueNumber: row.number, claimId: null, reason: "idle" as const, ...moveTo("open") };
}

/** Super-admin server action. Invoke periodically from an authenticated admin context.
 * The active clock starts at claimedAt, never offeredAt or createdAt.
 */
export async function releaseStaleClaims(projectId: string) {
  "use server";
  const admin = await requireSuperAdmin();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, tenantId: true } });
  if (!project) throw new IssueApiError(404, "Project not found.");
  const now = new Date();
  const { heartbeatMinutes } = await workflowFor(projectId);
  const cutoff = heartbeatCutoff(now, heartbeatMinutes);
  const candidates = await prisma.issueClaim.findMany({
    where: claimSweepWhere(now, cutoff, { projectId, tenantId: project.tenantId }),
    select: { id: true, bugId: true },
  });
  let released = 0;
  for (const candidate of candidates) {
    const outcome = await releaseClaimIfStale(
      { ...candidate, bug: { tenantId: project.tenantId, projectId: project.id } },
      cutoff, { actorUserId: admin.id });
    if (outcome.released) released++;
  }
  const waits = await sweepOwnerWaits(now, cutoff, { projectId, tenantId: project.tenantId }, { actorUserId: admin.id });
  return { released: released + waits.released };
}

export type ClaimSweepResult = { released: number };

/**
 * The scheduled sweep (#524): release every stale active claim across all
 * projects and publish `claim.released`. A reopened issue goes back to Open
 * for bids.
 * Called by the protected `POST /api/v1/claims/dispatch` route; no agent
 * context, and actorUserId stays null (the scheduler acted, not a person).
 */
export async function sweepStaleClaims(limit = 50): Promise<ClaimSweepResult> {
  const now = new Date();

  // Projects can have different heartbeat windows, so the sweep queries one
  // group per distinct window. A project without a workflow row joins the
  // default group, which also keeps test doubles without the delegate working.
  const delegate = (prisma as { projectWorkflow?: { findMany?: (args: unknown) => Promise<unknown> } })
    .projectWorkflow;
  const groups = new Map<number, string[] | null>();
  if (typeof delegate?.findMany === "function") {
    const rows = (await delegate.findMany({
      select: { projectId: true, heartbeatMinutes: true },
    })) as Array<{ projectId: string; heartbeatMinutes: number }>;
    for (const row of rows) {
      const projects = groups.get(row.heartbeatMinutes) ?? [];
      projects.push(row.projectId);
      groups.set(row.heartbeatMinutes, projects);
    }
    const withoutWorkflow = await prisma.project.findMany({
      where: { workflow: { is: null } },
      select: { id: true },
    });
    if (withoutWorkflow.length) {
      const fallback = groups.get(DEFAULT_PROJECT_WORKFLOW.heartbeatMinutes) ?? [];
      fallback.push(...withoutWorkflow.map((project) => project.id));
      groups.set(DEFAULT_PROJECT_WORKFLOW.heartbeatMinutes, fallback);
    }
  } else {
    groups.set(DEFAULT_PROJECT_WORKFLOW.heartbeatMinutes, null);
  }

  const candidates = new Map<string, { id: string; bugId: string; cutoff: Date; bug: { tenantId: string; projectId: string } }>();
  for (const [heartbeatMinutes, projectIds] of groups) {
    const cutoff = heartbeatCutoff(now, heartbeatMinutes);
    const rows = await prisma.issueClaim.findMany({
      where: claimSweepWhere(now, cutoff, projectIds ? { projectIds } : {}),
      select: { id: true, bugId: true, bug: { select: { tenantId: true, projectId: true } } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    for (const row of rows) {
      if (!candidates.has(row.id)) candidates.set(row.id, { ...row, cutoff });
      if (candidates.size >= limit) break;
    }
    if (candidates.size >= limit) break;
  }

  let released = 0;
  for (const candidate of candidates.values()) {
    const outcome = await releaseClaimIfStale(candidate, candidate.cutoff);
    if (outcome.released) released++;
  }
  // `cutoff` is scoped to the per-window loop above; the owner-wait release
  // path uses reason owner_unresponsive and does not consult it, so the
  // default window's cutoff is correct here (#1039).
  const waits = await sweepOwnerWaits(
    now,
    heartbeatCutoff(now, DEFAULT_PROJECT_WORKFLOW.heartbeatMinutes),
    {},
    { limit },
  );
  return { released: released + waits.released };
}
