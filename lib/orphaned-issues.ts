import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/agent-api/events";
import { issueChangePayload } from "@/lib/agent-api/web-events";
import { moveTo } from "@/lib/issue-substatus";

export const ORPHANED_ISSUE_BATCH = 100;

// A delivered fix is waiting for review, even if its assignee disappeared.
// An award under plan review (#plan-review) holds the issue through its
// planning claim, with no assignee yet: the plan window sweeper handles it.
export const orphanedWhere = {
  isDeleted: false,
  status: "in_progress",
  assigneeId: null,
  pullRequestUrl: null,
  claims: { none: { releasedAt: null, status: { in: ["active", "offered", "planning"] } } },
} satisfies Prisma.BugWhereInput;

/** Recover both existing orphans and issues unassigned by offboarding/manual edits.
 * The claim sweep cannot find these because they have no live claim (#623).
 */
export async function sweepOrphanedIssues(): Promise<{ reopened: number }> {
  const candidates = await prisma.bug.findMany({
    where: orphanedWhere,
    select: { id: true, organisationId: true, projectId: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: ORPHANED_ISSUE_BATCH,
  });
  let reopened = 0;
  for (const bug of candidates) {
    const changed = await prisma.$transaction(async (tx) => {
      // Claim creation/acceptance takes this same lock. Recheck the complete
      // predicate in the write after locking: selection is only a shortlist.
      await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${bug.id}
        AND "organisationId" = ${bug.organisationId} AND "projectId" = ${bug.projectId} FOR NO KEY UPDATE`;
      const updated = await tx.bug.updateMany({
        where: { id: bug.id, organisationId: bug.organisationId, projectId: bug.projectId, ...orphanedWhere },
        data: moveTo("open"),
      });
      if (!updated.count) return false;
      // A system event records why the status changed without attributing the
      // scheduled repair to the reporter or to an agent that did not perform it.
      await publish(tx, {
        organisationId: bug.organisationId,
        type: "issue.updated",
        bugId: bug.id,
        actorAgentId: null,
        payload: {
          issueId: bug.id,
          projectId: bug.projectId,
          ...issueChangePayload(moveTo("open")),
          actor: { type: "system" },
          reason: "orphaned_in_progress",
          previousStatus: "in_progress",
        },
      });
      return true;
    });
    if (changed) reopened++;
  }
  return { reopened };
}
