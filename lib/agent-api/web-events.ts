import type { Prisma, PrismaClient } from "@prisma/client";
import { publish, type EventPayload } from "@/lib/agent-api/events";

type Db = PrismaClient | Prisma.TransactionClient;

/** What a person did in the web app that agents need to hear about (#600). */
export type WebEventType =
  | "issue.updated"
  | "issue.deleted"
  | "issue.restored"
  | "comment.created"
  | "comment.edited"
  | "comment.deleted";

/**
 * Publish an event for something a person did in the web app (#600).
 *
 * Agents poll /api/v1/events (and webhooks fan out from it) to follow the
 * work. Until now only agent actions were published, so a person's reply to
 * an agent's comment, or a status change from triage, never reached any
 * agent. The event uses the same names and payload fields as the agent API
 * (`issueId`, `commentId`, `authorId`), plus `actor` so an agent can tell a
 * person from another agent. `actorAgentId` stays null.
 *
 * Call it inside the action's transaction, so the event exists exactly when
 * the change does.
 */
export async function publishWebEvent(
  db: Db,
  input: { bugId: string; type: WebEventType; actorUserId: string; payload?: EventPayload },
): Promise<void> {
  if (!db?.bug?.findUnique || !db?.user?.findUnique) return;
  const [bug, actor] = await Promise.all([
    db.bug.findUnique({ where: { id: input.bugId }, select: { organisationId: true, projectId: true } }),
    db.user.findUnique({ where: { id: input.actorUserId }, select: { name: true } }),
  ]);
  if (!bug) return;
  await publish(db, {
    organisationId: bug.organisationId,
    type: input.type,
    bugId: input.bugId,
    actorAgentId: null,
    payload: {
      issueId: input.bugId,
      projectId: bug.projectId,
      ...input.payload,
      actor: { type: "user", id: input.actorUserId, name: actor?.name ?? null },
    },
  });
}

const REPORTED_FIELDS = ["status", "substatus", "assigneeId", "typeId", "milestoneId", "title", "isBoosted"] as const;

/**
 * The fields an update changed, for an `issue.updated` payload: the names
 * of everything written, and the new value of the triage fields agents act
 * on (status, assignee, type, milestone, title).
 * Descriptions aren't copied into the event; agents read the issue for that.
 */
export function issueChangePayload(data: Record<string, unknown>): EventPayload {
  const values: Record<string, string | null> = {};
  for (const field of REPORTED_FIELDS) {
    const value = data[field];
    if (value === undefined) continue;
    values[field] = typeof value === "string" ? value : value === null ? null : String(value);
  }
  return { changed: Object.keys(data).filter((key) => key !== "updatedAt").sort(), values };
}
