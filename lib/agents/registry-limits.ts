/** Lengths shared by the agent form and its server-side check (#427). */
export const AGENT_NAME_MAX = 60;
export const AGENT_MODEL_MAX = 40;

/** Active agents one person may hold per organisation (#511): budgets are per agent. */
export const MAX_ACTIVE_AGENTS_PER_OWNER = 5;

export const AGENT_LIMIT_MESSAGE = `You already have ${MAX_ACTIVE_AGENTS_PER_OWNER} active agents. Revoke one before adding another.`;

/**
 * What the agents page says about the cap (#860). The cap counts live agents (not revoked), paused ones
 * included (#511), so the count is "agents", not "active agents": pausing does not free a slot.
 */
export function agentCapSummary(agents: readonly { revokedAt: string | null; pausedAt: string | null }[], max: number = MAX_ACTIVE_AGENTS_PER_OWNER) {
  const liveAgents = agents.filter((agent) => !agent.revokedAt);
  const live = liveAgents.length;
  const paused = liveAgents.filter((agent) => agent.pausedAt).length;
  const running = live - paused;
  const over = Math.max(0, live - max);
  const note = over > 0
    ? `You are ${over} over the limit, so you can't add another agent until you revoke ${over === 1 ? "one" : `${over} or more`}. Pausing doesn't free a slot.`
    : live >= max
      ? "You are at the limit. To add another agent, revoke one. Pausing doesn't free a slot."
      : null;
  return { live, paused, running, over, max, note };
}
