import type { AgentLevel, Prisma } from "@prisma/client";

/**
 * Agents are their owner's (#user-agents), switched on in the organisations
 * they choose. These helpers read an agent's place in one organisation.
 */

/** Agents active in an organisation. Spread into an agent filter: `{ ...activeIn(organisationId), revokedAt: null }`. */
export function activeIn(organisationId: string): Prisma.AgentWhereInput {
  return { activations: { some: { organisationId, deactivatedAt: null } } };
}

/** Select an agent's live activations with their class: `agent: { select: { activations: activeLevels } }`. */
export const activeLevels = {
  where: { deactivatedAt: null },
  select: { organisationId: true, level: true },
} satisfies Prisma.Agent$activationsArgs;

type WithLevels = { activations: { organisationId: string; level: AgentLevel }[] };

/**
 * The agent's class in one organisation, from `activeLevels`. An agent that is
 * no longer active there counts as a working agent: a vote it cast while active
 * keeps the weight of an ordinary one.
 */
export function levelIn(agent: WithLevels | null | undefined, organisationId: string): AgentLevel {
  return agent?.activations?.find((row) => row.organisationId === organisationId)?.level ?? "working";
}

/** Whether the agent is active in the organisation, from `activeLevels`. */
export function isActiveIn(agent: WithLevels | null | undefined, organisationId: string): boolean {
  return Boolean(agent?.activations?.some((row) => row.organisationId === organisationId));
}
