import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { IssueApiError } from "@/lib/agent-api/errors";
import { EARN_TASKS, EARN_WORK } from "@/lib/earn/draft";
import { EARN_TASK_CHECKS } from "@/lib/earn/task-ui";

/**
 * A manager agent checks Earn tasks before a person does (#earn-agent-review). It lists the marketing tasks
 * earners have sent in and gives each a verdict: ready to pay, or send back with what to fix, with how sure it
 * is. The verdict is advice only: it never pays and never sends anything back. A person still confirms or sends
 * back on Site admin -> Earn tasks, where the verdict shows beside the proof.
 *
 * Only a manager agent in the Ziki Earn workspace may check, and never a task its own owner sent in.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** The parts of the calling agent these rules need. */
export type EarnReviewer = { agentId: string; ownerId: string; tenantId: string };

export const earnVerdictInput = z.object({
  verdict: z.enum(["ready", "send_back"]),
  reason: z.string().trim().min(1, "Say what you checked.").max(2000),
  confidence: z.number().int().min(0).max(100),
});
export type EarnVerdictInput = z.infer<typeof earnVerdictInput>;

/** Refuses an agent from outside the Earn workspace: Earn tasks are checked only there. */
function requireEarnTenant(agent: EarnReviewer, earnTenantId: string | null): void {
  if (!earnTenantId || agent.tenantId !== earnTenantId) {
    throw new IssueApiError(403, "Only a manager agent in the Ziki Earn workspace can check Earn tasks.");
  }
}

/**
 * The tasks waiting for checking, oldest first, with what each asks for and its checklist, so the agent can
 * judge the proof against them. Tasks its own owner sent in are left out: it may not check those.
 */
export async function listEarnTasksToCheck(db: Db, agent: EarnReviewer, earnTenantId: string | null) {
  requireEarnTenant(agent, earnTenantId);
  const rows = await db.earnTaskProgress.findMany({
    where: { status: "submitted", userId: { not: agent.ownerId } },
    orderBy: { submittedAt: "asc" },
    take: 50,
    select: { id: true, taskKey: true, proof: true, submittedAt: true, agentVerdict: true, agentReason: true, agentConfidence: true, agentVerdictById: true },
  });
  return rows.flatMap((row) => {
    const task = EARN_TASKS.find((candidate) => candidate.id === row.taskKey);
    if (!task) return [];
    return [{
      id: row.id,
      task: { key: task.id, title: task.title, detail: task.detail, pay: task.pay, proofLabel: EARN_WORK[task.id].proofLabel, checklist: EARN_TASK_CHECKS[task.id] },
      proof: row.proof,
      submittedAt: row.submittedAt,
      verdict: row.agentVerdict ? { verdict: row.agentVerdict, reason: row.agentReason, confidence: row.agentConfidence, byYou: row.agentVerdictById === agent.agentId } : null,
    }];
  });
}

/**
 * Gives (or replaces) the agent's verdict on one task that is waiting for checking. It only records the advice:
 * the task stays waiting until a person decides.
 */
export async function giveEarnVerdict(db: Db, agent: EarnReviewer, earnTenantId: string | null, id: string, input: EarnVerdictInput) {
  requireEarnTenant(agent, earnTenantId);
  const verdict = earnVerdictInput.parse(input);
  const row = await db.earnTaskProgress.findUnique({ where: { id }, select: { id: true, userId: true, status: true } });
  if (!row) throw new IssueApiError(404, "That Earn task doesn't exist.");
  if (row.userId === agent.ownerId) throw new IssueApiError(403, "An agent can't check a task its own owner sent in.");
  if (row.status !== "submitted") throw new IssueApiError(409, "This task isn't waiting for checking.");
  await db.earnTaskProgress.update({
    where: { id },
    data: { agentVerdict: verdict.verdict, agentReason: verdict.reason, agentConfidence: verdict.confidence, agentVerdictById: agent.agentId, agentVerdictAt: new Date() },
  });
  return { id, verdict: verdict.verdict, reason: verdict.reason, confidence: verdict.confidence, status: "submitted" as const };
}
