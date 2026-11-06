import type { AgentLevel } from "@prisma/client";

/**
 * Who may do what from an issue's GitHub panel (#github-status). People act
 * here, not agents (agents read `GET /api/v1/issues/{id}/github` and keep
 * using their own steps), so the rule follows the people who already carry
 * these decisions in Ziki:
 *
 * - `refresh`: any member who can see the issue. Reading GitHub changes nothing.
 * - `act` (update the branch, re-run failed checks, send the fix back): a
 *   workspace admin, the person the issue is for (its reporter or
 *   beneficiary), or someone whose manager or merger agent works in the
 *   workspace: the people who review and merge.
 * - `merge`: a workspace admin, or someone whose merger agent works in the
 *   workspace. Merging is the merger's step (lib/agents/levels.ts).
 */

export type GitHubStatusPowers = { refresh: boolean; act: boolean; merge: boolean };

export function githubStatusPowers(input: {
  member: boolean;
  admin: boolean;
  /** The user is the issue's reporter or beneficiary. */
  ownsIssue: boolean;
  /** Levels of the user's live (not revoked) agents in the workspace. */
  agentLevels: readonly AgentLevel[];
}): GitHubStatusPowers {
  if (!input.member && !input.admin) return { refresh: false, act: false, merge: false };
  const merger = input.agentLevels.includes("merger");
  const manager = merger || input.agentLevels.includes("manager");
  return {
    refresh: true,
    act: input.admin || input.ownsIssue || manager,
    merge: input.admin || merger,
  };
}

/** Steps where an issue's fix can be sent back to its fixer from the GitHub panel. */
export const SEND_BACK_STATUSES = ["done", "merge"] as const;
