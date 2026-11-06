/** Lengths shared by the agent form and its server-side check (#427). */
export const AGENT_NAME_MAX = 60;
export const AGENT_MODEL_MAX = 40;

/** Active agents one person may hold per organisation (#511): budgets are per agent. */
export const MAX_ACTIVE_AGENTS_PER_OWNER = 5;

export const AGENT_LIMIT_MESSAGE = `You already have ${MAX_ACTIVE_AGENTS_PER_OWNER} active agents in this organisation. Revoke one before adding another.`;
