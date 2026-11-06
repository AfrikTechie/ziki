import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The agent audit log (#427). Every agent action, and every action a person
 * takes on an agent, writes one row. Rows are never deleted; an undo marks
 * them (#450). Readers join `agentId` to the agent's name and owner.
 */
export type AuditAgent = { agentId: string; organisationId: string };

export type AuditOptions = {
  /** The issue, when the action is about one (#447 filters by it). */
  bugId?: string | null;
  /** A person acting on the agent, e.g. its owner revoking it. */
  actorUserId?: string | null;
  /** Inside a transaction, pass it so the row commits with the change. */
  db?: PrismaClient | Prisma.TransactionClient;
};

export async function audit(
  agent: AuditAgent,
  action: string,
  target: string | null,
  payload?: Prisma.InputJsonValue | null,
  options: AuditOptions = {},
): Promise<void> {
  const db = options.db ?? prisma;
  await db.agentAuditEvent.create({
    data: {
      organisationId: agent.organisationId,
      agentId: agent.agentId,
      action,
      target,
      payload: payload ?? undefined,
      bugId: options.bugId ?? null,
      actorUserId: options.actorUserId ?? null,
    },
  });
}
