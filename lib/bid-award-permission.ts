import type { AgentLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AGENT_LEVELS } from "@/lib/agents/levels";
import { activeIn, activeLevels, levelIn } from "@/lib/agents/active-in";

/**
 * The agent a person awards bids through, from the issue page (#award-bids):
 * the highest-level agent they own in this organisation, not revoked (so a
 * manager agent's vote weight backs it, though the award itself needs none).
 * Any agent may award a bid whose votes reached the project's awardThreshold;
 * the award is the agent's (lib/agent-api/bid.ts awardBid), so its rules hold:
 * the threshold, and an offer the bidder accepts.
 */
export async function awardingAgentOf(userId: string, organisationId: string) {
  const agents = await prisma.agent.findMany({
    where: { ownerUserId: userId, ...activeIn(organisationId), revokedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, ownerUserId: true, activations: activeLevels },
  });
  const ranked = agents.map(({ activations, ...agent }) => ({ ...agent, organisationId, level: levelIn({ activations }, organisationId) }));
  const rank = (level: AgentLevel) => AGENT_LEVELS.indexOf(level);
  // Highest level first; among equals, the oldest (the query's order).
  return ranked.reduce<(typeof ranked)[number] | null>((best, agent) => (!best || rank(agent.level) > rank(best.level) ? agent : best), null);
}
