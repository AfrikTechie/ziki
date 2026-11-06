"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-helpers";
import { IssueApiError } from "@/lib/agent-api/errors";
import { fromZodError, type FieldErrorResult } from "@/lib/form-errors";
import {
  createAgentPreference,
  deleteAgentPreference,
  updateAgentPreference,
  type AgentPreferenceRecord,
} from "@/lib/agent-preferences";

/**
 * The signed-in person's side of #838. The page at /agents/mine/preferences
 * cannot call the agent API — a browser has no agent key — so it mutates through
 * these instead, and both land in `lib/agent-preferences.ts` with the session's
 * user id, which is why the two paths behave identically.
 */

const PAGE = "/agents/mine/preferences";

/** A refusal carries the message, and the field when Zod named one. */
type PreferenceFailure = { ok: false } & FieldErrorResult;

/** Adding and saving hand back the row they wrote, so the list can draw it at once. */
export type PreferenceSavedResult =
  | { ok: true; preference: AgentPreferenceRecord }
  | PreferenceFailure;

/** Deleting has no row to hand back, only the outcome. */
export type PreferenceDeletedResult = { ok: true } | PreferenceFailure;

/** Whatever the data layer refused, as the form shows it. */
function refused(error: unknown): PreferenceFailure {
  // Zod's messages name the field, which is where focus should go.
  if (error instanceof z.ZodError) return { ok: false, ...fromZodError(error) };
  // The data layer's own refusals already read as sentences: 404 on an id that
  // is missing or someone else's, 409 at the 20-instruction cap.
  if (error instanceof IssueApiError) return { ok: false, error: error.message };
  console.error("[agent-preferences] action failed", error);
  return { ok: false, error: "That didn't save. Try again." };
}

/** Plain strings out of FormData-less calls; a missing or non-text field becomes "". */
const textField = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Add an instruction. `requireUser()` stays outside the try: it redirects when
 * the session is gone, and that thrown sentinel has to reach Next unwrapped.
 */
export async function addPreferenceAction(input: { content?: unknown }): Promise<PreferenceSavedResult> {
  const user = await requireUser();
  try {
    const preference = await createAgentPreference(user.id, { content: textField(input?.content) });
    revalidatePath(PAGE);
    return { ok: true, preference };
  } catch (error) {
    return refused(error);
  }
}

/** Replace one instruction's text. An id that isn't the caller's answers 404 here too. */
export async function savePreferenceAction(input: { id?: unknown; content?: unknown }): Promise<PreferenceSavedResult> {
  const user = await requireUser();
  try {
    const preference = await updateAgentPreference(user.id, textField(input?.id), {
      content: textField(input?.content),
    });
    revalidatePath(PAGE);
    return { ok: true, preference };
  } catch (error) {
    return refused(error);
  }
}

/** Delete one instruction. The caller confirms first; this is the point of no return. */
export async function deletePreferenceAction(input: { id?: unknown }): Promise<PreferenceDeletedResult> {
  const user = await requireUser();
  try {
    await deleteAgentPreference(user.id, textField(input?.id));
    revalidatePath(PAGE);
    return { ok: true };
  } catch (error) {
    return refused(error);
  }
}
