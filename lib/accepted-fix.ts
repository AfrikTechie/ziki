import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { moveTo } from "@/lib/issue-substatus";
import { reportedClosedUnmerged } from "@/lib/agent-api/pull-request-report";

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

/**
 * Whether a different pull request may be linked to an issue whose fix was
 * accepted (#replacement-pr).
 *
 * An accepted fix is bound to the pull request that was reviewed (#489), so a
 * swap is refused, with one exception: when the latest pull request report says
 * the accepted pull request was closed without being merged it can never merge,
 * and the contributor may attach a replacement. The replacement is judged and
 * accepted again (`releaseAcceptedFix`).
 *
 * `acceptance` is the standing acceptance, if any; `replaceable` is true only
 * when there is one and its pull request is reported closed unmerged. With no
 * acceptance, nothing binds the link and `replaceable` is false.
 */
export async function acceptedFixGate(
  bugId: string,
  previousPullRequestUrl: string | null | undefined,
  db: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<{ acceptance: { id: string; payload: unknown } | null; replaceable: boolean }> {
  const acceptance = await standingAcceptance(db, bugId);
  if (!acceptance || !previousPullRequestUrl) return { acceptance, replaceable: false };
  return { acceptance, replaceable: await reportedClosedUnmerged(bugId, previousPullRequestUrl) };
}

/**
 * Restart review after a replacement pull request replaced an accepted one that
 * was closed unmerged (#replacement-pr). Inside the caller's transaction:
 *
 * - the standing acceptance is stamped `undoneAt`, so it no longer gates anything
 *   and the new pull request must be accepted on its own review;
 * - an issue in Done or Merge goes back to Done · Requires review;
 * - judgements and merge reviews are keyed to the pull request they were given
 *   on, so those on the old address stay there and stop counting for the new one;
 * - an activity row records "replaces <old>".
 *
 * The caller records the audit row and event for its own action, with
 * `replacesPullRequestUrl` in the payload.
 */
export async function releaseAcceptedFix(
  tx: Prisma.TransactionClient,
  input: { bugId: string; acceptanceId: string; previous: string; next: string; actorUserId: string },
): Promise<void> {
  await tx.agentAuditEvent.update({ where: { id: input.acceptanceId }, data: { undoneAt: new Date() } });
  await tx.bug.updateMany({
    where: { id: input.bugId, status: { in: ["done", "merge"] } },
    data: moveTo("requires_review"),
  });
  await tx.bugActivity.create({
    data: {
      bugId: input.bugId,
      actorId: input.actorUserId,
      type: "status_changed",
      summary: `replaced the accepted pull request ${input.previous} (closed without merging) with ${input.next}; it needs review again`,
      metadata: {
        field: "status",
        to: "requires_review",
        replacesPullRequestUrl: input.previous,
        pullRequestUrl: input.next,
        acceptanceId: input.acceptanceId,
      },
    },
  });
}
