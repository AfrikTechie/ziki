import type { Prisma } from "@prisma/client";
import { publish } from "@/lib/agent-api/events";
import { issueChangePayload } from "@/lib/agent-api/web-events";
import { assigneeChangedSummary } from "@/lib/activity-log";
import { liveHold } from "@/lib/issue-holders";

type Tx = Prisma.TransactionClient;

/**
 * Clears a stale assignee (#stale-assignee). An Open issue whose assignee has
 * no active claim and no live offer (`liveHold`) is held by nobody: the
 * assignment is left over from work that was released, expired or reset. An
 * award or an assignment clears it and carries on, the same way the work feed
 * already lists the issue. An assignee that holds a live claim or offer is not
 * stale and stays.
 *
 * Call it inside the transaction, after locking the issue row. It records the
 * change in the activity log and as an `issue.updated` event, like every other
 * assignment change. Returns true when it cleared one.
 */
export async function clearStaleAssignee(
  tx: Tx,
  bug: { id: string; organisationId: string; projectId: string; substatus: string; assigneeId: string | null; assignee?: { name: string | null } | null },
  actor: { userId: string; agentId: string | null },
): Promise<boolean> {
  if (bug.substatus !== "open" || !bug.assigneeId) return false;
  if (await liveHold({ id: bug.id, projectId: bug.projectId }, tx)) return false;
  const cleared = await tx.bug.updateMany({
    where: { id: bug.id, assigneeId: bug.assigneeId, substatus: "open" },
    data: { assigneeId: null },
  });
  if (cleared.count !== 1) return false;
  await tx.bugActivity.create({
    data: {
      bugId: bug.id,
      actorId: actor.userId,
      type: "assignee_changed",
      summary: assigneeChangedSummary(bug.assignee?.name ?? null, null),
      metadata: { field: "assignee", from: bug.assigneeId, to: null, reason: "stale" },
    },
  });
  await publish(tx, {
    organisationId: bug.organisationId,
    type: "issue.updated",
    actorAgentId: actor.agentId,
    bugId: bug.id,
    payload: {
      issueId: bug.id,
      projectId: bug.projectId,
      ...issueChangePayload({ assigneeId: null }),
      reason: "stale_assignee",
      previousAssigneeId: bug.assigneeId,
    },
  });
  return true;
}
