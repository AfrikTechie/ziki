import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { IssueApiError } from "@/lib/agent-api/errors";
import { EARN_TASKS, EARN_WORK, type EarnTaskId } from "@/lib/earn/draft";
import { EARN_TASK_CHECKS } from "@/lib/earn/task-ui";
import { EARN_PROOF_MAX, loadRows, proofCount, submitTask, taskStateFor } from "@/lib/earn/progress";
import { parseResearch } from "@/lib/earn/outreach";

/**
 * An earner's own agent does their Earn tasks (#earn-agent-tasks). The agent lives in the Ziki Earn workspace and
 * sends in, for its owner, the tasks it can do by itself: Tell us who needs Ziki and Research 10 people. The other
 * two go out from the owner's own email and social accounts, so the owner sends those in from the app. Sending a
 * task in never pays: a person at Ziki still checks it and confirms, as for any task.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** The parts of the calling agent these rules need. */
export type EarnWorker = { agentId: string; ownerId: string; tenantId: string };

/** The tasks an agent may send in for its owner. */
export const AGENT_EARN_TASKS: readonly EarnTaskId[] = ["who", "research"];

export const earnSubmitInput = z.object({
  proof: z.string().trim().min(1, "Add the answer.").max(EARN_PROOF_MAX),
});
export type EarnSubmitInput = z.infer<typeof earnSubmitInput>;

function requireEarnTenant(agent: EarnWorker, earnTenantId: string | null): void {
  if (!earnTenantId || agent.tenantId !== earnTenantId) {
    throw new IssueApiError(403, "Only an agent in the Ziki Earn workspace can do Earn tasks.");
  }
}

/** The owner's four tasks, each with what it asks for, where it stands, and whether the agent can send it in. */
export async function listOwnEarnTasks(db: Db, agent: EarnWorker, earnTenantId: string | null) {
  requireEarnTenant(agent, earnTenantId);
  const rows = await loadRows(db, agent.ownerId);
  return EARN_TASKS.map((task, index) => {
    const row = rows.find((candidate) => candidate.taskKey === task.id);
    const state = taskStateFor(rows, index);
    return {
      n: index + 1,
      key: task.id,
      title: task.title,
      detail: task.detail,
      pay: task.pay,
      target: task.target,
      agentPart: EARN_WORK[task.id].agent,
      ownerPart: EARN_WORK[task.id].you,
      proofLabel: EARN_WORK[task.id].proofLabel,
      example: EARN_WORK[task.id].proofHint,
      checklist: EARN_TASK_CHECKS[task.id],
      state,
      proof: row?.proof ?? null,
      sentBack: row?.status === "rejected" ? row.note : null,
      agentCanSend: AGENT_EARN_TASKS.includes(task.id),
    };
  });
}

/**
 * Sends one of the owner's tasks in for checking, as the owner would from the app. Only the tasks an agent can do
 * by itself; a resend after a send-back replaces the answer. Research needs ten businesses, one per line.
 */
export async function agentSubmitEarnTask(db: Db, agent: EarnWorker, earnTenantId: string | null, n: number, input: EarnSubmitInput) {
  requireEarnTenant(agent, earnTenantId);
  const task = Number.isInteger(n) && n >= 1 && n <= EARN_TASKS.length ? EARN_TASKS[n - 1] : null;
  if (!task) throw new IssueApiError(404, "That Earn task doesn't exist.");
  if (!AGENT_EARN_TASKS.includes(task.id)) {
    throw new IssueApiError(403, "Your owner sends this task in themselves: it goes out from their own email or social accounts.");
  }
  const { proof } = earnSubmitInput.parse(input);
  if (task.id === "research") {
    const found = Math.min(parseResearch(proof).length, proofCount(task, proof));
    if (found < task.target) throw new IssueApiError(422, `The list has ${found} businesses; the task asks for ${task.target}, one per line: name, where, email or website.`);
  }
  const result = await submitTask(db, agent.ownerId, n, proof);
  if (!result.ok) throw new IssueApiError(409, result.error);
  return { n, key: task.id, title: task.title, state: "in-review" as const };
}
