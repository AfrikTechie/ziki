import type { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { agentMentionId, extractMentionedAgentIds } from "@/lib/mentions";
import { activeIn } from "@/lib/agents/active-in";

type Db = typeof prisma | Prisma.TransactionClient;

export type MentionedAgent = { id: string; name: string; ownerUserId: string };

/**
 * The live agents in `organisationId` that `body` mentions as
 * `@[Name](agent:<id>)` (#603). Agents from another organisation, or revoked ones,
 * are left out, so their tags degrade to plain text on normalize.
 */
export async function mentionedAgents(
  db: Db,
  organisationId: string,
  body: string,
): Promise<MentionedAgent[]> {
  const ids = extractMentionedAgentIds(body);
  if (ids.length === 0) return [];
  return db.agent.findMany({
    where: { id: { in: ids }, ...activeIn(organisationId), revokedAt: null },
    select: { id: true, name: true, ownerUserId: true },
  });
}

/** `agent:<id>` → name entries to merge into a `normalizeMentions` map. */
export function agentMentionNames(agents: MentionedAgent[]): [string, string][] {
  return agents.map((agent) => [agentMentionId(agent.id), agent.name]);
}

/** The people to notify when their agents are mentioned, once each. */
export function agentOwnerIds(agents: MentionedAgent[]): string[] {
  return [...new Set(agents.map((agent) => agent.ownerUserId))];
}
