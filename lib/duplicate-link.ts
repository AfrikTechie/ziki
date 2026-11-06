import type { Prisma } from "@prisma/client";
import { formatIssueNumber } from "@/lib/issue-number";
import { duplicateLinkProblem, type LinkSide } from "@/lib/duplicates";

/** Thrown when an issue can't be marked a duplicate of the other; the message says why. */
export class DuplicateLinkRefused extends Error {}

/**
 * Marks `bugId` a duplicate of `targetId` (#285), in the caller's
 * transaction: the one way to set `Bug.duplicateOfId`, used by the admin's
 * "mark duplicate" action and by closing an issue as a duplicate
 * (#close-reasons). One level only; both rows are locked while checking so
 * two writers can't build a chain between them at the same moment. Records a
 * `duplicate_changed` activity on both issues. Returns the previous target
 * (null when there was none), or `unchanged` when it already pointed there.
 */
export async function linkDuplicate(
  tx: Prisma.TransactionClient,
  input: { organisationId: string; bugId: string; targetId: string; actorId: string },
): Promise<{ previous: string | null; unchanged: boolean; target: { id: string; number: number } }> {
  const { organisationId, bugId, targetId, actorId } = input;
  const rows = await tx.$queryRaw<LinkSide[]>`
    SELECT "id", "number", "isDeleted", "duplicateOfId" FROM "Bug"
    WHERE "id" IN (${bugId}, ${targetId}) AND "organisationId" = ${organisationId}
    ORDER BY "id"
    FOR UPDATE`;
  const bug = rows.find((r) => r.id === bugId);
  if (!bug) throw new DuplicateLinkRefused("This issue no longer exists.");
  const to = rows.find((r) => r.id === targetId) ?? null;

  const incoming = await tx.bug.count({ where: { duplicateOfId: bugId } });
  const canonical = to?.duplicateOfId
    ? await tx.bug.findUnique({ where: { id: to.duplicateOfId }, select: { number: true } })
    : null;
  const problem = duplicateLinkProblem(bug, to, incoming, canonical);
  if (problem || !to) throw new DuplicateLinkRefused(problem ?? "That issue doesn't exist.");
  if (bug.duplicateOfId === to.id) return { previous: to.id, unchanged: true, target: { id: to.id, number: to.number } };

  const previous = bug.duplicateOfId;
  await tx.bug.update({ where: { id: bugId }, data: { duplicateOfId: to.id } });
  await tx.bugActivity.createMany({
    data: [
      {
        bugId,
        actorId,
        type: "duplicate_changed",
        summary: `marked this as a duplicate of ${formatIssueNumber(to.number)}`,
        metadata: { field: "duplicateOf", from: previous, to: to.id },
      },
      {
        bugId: to.id,
        actorId,
        type: "duplicate_changed",
        summary: `marked ${formatIssueNumber(bug.number)} as a duplicate of this issue`,
        metadata: { field: "duplicates", to: bugId },
      },
    ],
  });
  return { previous, unchanged: false, target: { id: to.id, number: to.number } };
}
