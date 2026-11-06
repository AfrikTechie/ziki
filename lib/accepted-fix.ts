import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * The `issue.accepted` audit row that still stands for an issue (#490).
 *
 * Acceptance lives on the audit row rather than on `Bug.status`, so this is
 * the single test for "a manager accepted this fix". A organisation admin undo
 * (#450) stamps `undoneAt`; an undone acceptance must not gate anything.
 *
 * The payload carries what was accepted (#489): the pull request and its head
 * commit at the time, so a different pull request can't be swapped in.
 */
export async function standingAcceptance(
  db: PrismaClient | Prisma.TransactionClient,
  bugId: string,
): Promise<{ id: string; payload: unknown } | null> {
  return db.agentAuditEvent.findFirst({
    where: { bugId, action: "issue.accepted", undoneAt: null },
    select: { id: true, payload: true },
  });
}
