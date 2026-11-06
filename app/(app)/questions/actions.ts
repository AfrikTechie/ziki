"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { answerSchema, answerAgentQuestion } from "@/lib/agent-questions";
import { IssueApiError } from "@/lib/agent-api/errors";

/**
 * The owner answers a question (#446). The lib checks that this person really
 * is the owner; the form just carries their words.
 */
export type AnswerActionResult = { ok: true } | { ok: false; error: string };

export async function answerQuestionAction(
  _previous: AnswerActionResult | undefined,
  formData: FormData,
): Promise<AnswerActionResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: "Organisation membership required." };

  const questionId = formData.get("questionId");
  if (typeof questionId !== "string" || !questionId) return { ok: false, error: "Invalid question." };

  const parsed = answerSchema.safeParse({ answer: formData.get("answer") ?? "" });
  if (!parsed.success) return { ok: false, error: "Write an answer before sending it." };

  try {
    await answerAgentQuestion(user.id, organisationId, questionId, parsed.data.answer);
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    throw error;
  }

  revalidatePath("/questions");
  revalidatePath(`/questions/${questionId}`);
  return { ok: true };
}
