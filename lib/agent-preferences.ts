import { prisma } from "@/lib/prisma";
import { IssueApiError } from "@/lib/agent-api/errors";
import {
  AGENT_PREFERENCES_MAX,
  agentPreferenceCreateSchema,
  agentPreferenceUpdateSchema,
} from "@/lib/validations/agent-preferences";

/**
 * A person's standing instructions for every agent they own (#838).
 *
 * This is the only module that touches `AgentPreference`. Every function takes
 * the owning `userId` and puts it in the `where`, so there is no path that can
 * read, change or delete another person's instruction: a foreign id simply
 * matches nothing and answers 404.
 *
 * The page reaches it through server actions (a session cookie); the agent API
 * reaches it through `/api/v1/agents/me/preferences` (a Bearer key, whose owner
 * is `agent.ownerId`). Both hand in the same kind of id, so both get the same
 * behaviour and the same limits.
 */

/** One instruction as both entry points return it. `userId` is never echoed: the caller already is the owner. */
export type AgentPreferenceRecord = {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT = { id: true, content: true, createdAt: true, updatedAt: true } as const;

/** Read the same whether it never existed or belongs to someone else. */
const NOT_FOUND = "That instruction doesn't exist, or it isn't yours.";

const notFound = () => new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });

/** Every instruction this user owns, oldest first, so the list reads in the order they were written. */
export async function listAgentPreferences(userId: string): Promise<AgentPreferenceRecord[]> {
  return prisma.agentPreference.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: SELECT,
  });
}

/**
 * Add one instruction. Blank or over-long text is refused by the schema (422);
 * past `AGENT_PREFERENCES_MAX` the create is refused (409) rather than letting
 * the list grow without bound. The count and the create share a transaction so
 * two agents adding at once cannot slip past the cap.
 */
export async function createAgentPreference(userId: string, input: unknown): Promise<AgentPreferenceRecord> {
  const parsed = agentPreferenceCreateSchema.safeParse(input);
  if (!parsed.success) throw parsed.error;

  return prisma.$transaction(async (tx) => {
    const count = await tx.agentPreference.count({ where: { userId } });
    if (count >= AGENT_PREFERENCES_MAX) {
      const message = `You already have ${AGENT_PREFERENCES_MAX} instructions. Delete one before adding another.`;
      throw new IssueApiError(409, message, { error: "too_many_preferences", message });
    }
    return tx.agentPreference.create({
      data: { userId, content: parsed.data.content },
      select: SELECT,
    });
  });
}

/**
 * Replace one instruction's text. `updateMany` carries the `userId`, so an id
 * that is missing or someone else's changes nothing and answers 404 — never
 * someone else's row.
 */
export async function updateAgentPreference(
  userId: string,
  id: string,
  input: unknown,
): Promise<AgentPreferenceRecord> {
  const parsed = agentPreferenceUpdateSchema.safeParse(input);
  if (!parsed.success) throw parsed.error;

  const changed = await prisma.agentPreference.updateMany({
    where: { id, userId },
    data: { content: parsed.data.content },
  });
  if (changed.count === 0) throw notFound();

  const row = await prisma.agentPreference.findUnique({ where: { id }, select: SELECT });
  // Only reachable if the row went away between the two calls; hand back the
  // same 404 rather than reporting success for something that is no longer there.
  if (!row) throw notFound();
  return row;
}

/** Delete one instruction. Scoped in the same call, so a foreign id deletes nothing and answers 404. */
export async function deleteAgentPreference(userId: string, id: string): Promise<void> {
  const deleted = await prisma.agentPreference.deleteMany({ where: { id, userId } });
  if (deleted.count === 0) throw notFound();
}
