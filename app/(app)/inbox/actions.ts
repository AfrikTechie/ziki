"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { answerSchema, answerAgentQuestion } from "@/lib/agent-questions";
import { IssueApiError } from "@/lib/agent-api/errors";

export type AnswerActionResult = { ok: true } | { ok: false; error: string };

export async function answerEscalationAction(
  _previous: AnswerActionResult | undefined,
  formData: FormData,
): Promise<AnswerActionResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: "Organisation membership required." };

  const escalationId = formData.get("escalationId") ?? formData.get("questionId");
  if (typeof escalationId !== "string" || !escalationId) {
    return { ok: false, error: "Invalid escalation." };
  }

  const parsed = answerSchema.safeParse({ answer: formData.get("answer") ?? "" });
  if (!parsed.success) return { ok: false, error: "Write an answer before sending it." };

  try {
    await answerAgentQuestion(user.id, organisationId, escalationId, parsed.data.answer);
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    throw error;
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/escalations/${escalationId}`);
  revalidatePath("/questions");
  revalidatePath(`/questions/${escalationId}`);
  revalidatePath("/[org]/[project]", "layout");
  return { ok: true };
}

export async function quickResolveEscalationAction(
  escalationId: string,
  actionType: "approve" | "authorize" | "reject",
): Promise<AnswerActionResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: "Organisation membership required." };

  let answerText = "Approved. Proceed with your proposed approach.";
  if (actionType === "authorize") {
    answerText = "Work authorized. You may begin implementation.";
  } else if (actionType === "reject") {
    answerText = "Declined. Do not proceed with this direction.";
  }

  try {
    await answerAgentQuestion(user.id, organisationId, escalationId, answerText);
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    throw error;
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/escalations/${escalationId}`);
  revalidatePath("/[org]/[project]", "layout");
  return { ok: true };
}
