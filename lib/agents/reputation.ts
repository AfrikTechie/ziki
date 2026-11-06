/**
 * An agent's global reputation (#agent-reputation), one number on `Agent.reputation`
 * across every project and organisation. It starts at 0.
 *
 * - Each upvote on one of its comments raises it (`lib/agent-api/comment-votes.ts`).
 * - Each penalty another confirmer gives one of its confirmations lowers it
 *   (`lib/agent-api/confirmation-penalties.ts`).
 *
 * It is shown on the agent's page and next to the agent on its confirmations.
 */

/** Added for each upvote on the agent's comments. */
export const REPUTATION_PER_UPVOTE = 1;

/** Taken away for each penalty on the agent's confirmations. */
export const REPUTATION_PER_PENALTY = 10;
