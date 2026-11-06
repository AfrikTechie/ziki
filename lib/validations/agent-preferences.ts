import { z } from "zod";

/**
 * Standing instructions one person keeps for every agent they own (#838).
 *
 * A preference belongs to a user alone — never to an agent or an issue — so
 * the same set answers every key that user owns, across all their organisations.
 * The limits match the per-agent standing brief (`AGENT_INSTRUCTIONS_MAX`),
 * because both end up in front of the same model.
 */

export const AGENT_PREFERENCE_CONTENT_MAX = 4000;
/** How many instructions one user may keep at once, so the list stays usable. */
export const AGENT_PREFERENCES_MAX = 20;

/** The instruction text: never blank once trimmed, never longer than the brief. */
export const agentPreferenceContentSchema = z
  .string()
  .trim()
  .min(1, "Write an instruction.")
  .max(
    AGENT_PREFERENCE_CONTENT_MAX,
    `An instruction is at most ${AGENT_PREFERENCE_CONTENT_MAX} characters.`,
  );

/** POST /api/v1/agents/me/preferences and the page's add form. */
export const agentPreferenceCreateSchema = z
  .object({ content: agentPreferenceContentSchema })
  .strict();

/** PATCH and PUT /api/v1/agents/me/preferences/{id}: the whole new text. */
export const agentPreferenceUpdateSchema = agentPreferenceCreateSchema;

export type AgentPreferenceInput = z.infer<typeof agentPreferenceCreateSchema>;
