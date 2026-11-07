"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { consumeRateLimit, ACTION_RATE_LIMITS, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { IssueApiError } from "@/lib/agent-api/errors";
import {
  createSupportThreadSchema,
  addRequesterMessageSchema,
  takeSupportThreadSchema,
  replySupportThreadSchema,
  releaseSupportThreadSchema,
  resolveSupportThreadSchema,
} from "@/lib/validations/support-thread";
import {
  createSupportThread,
  addRequesterMessage,
  takeSupportThread,
  replySupportThread,
  releaseSupportThread,
  resolveSupportThread,
} from "@/lib/support-threads";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function createSupportThreadAction(input: unknown): Promise<ActionResult<{ threadId: string }>> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`support-thread:${user.id}`, ACTION_RATE_LIMITS.supportThread);
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const parsed = createSupportThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const bug = await prisma.bug.findUnique({
    where: { id: parsed.data.issueId, isDeleted: false },
    select: { id: true, organisationId: true },
  });
  if (!bug) return { ok: false, error: "Issue not found." };

  const isMember = await prisma.membership.findFirst({
    where: { userId: user.id, organisationId: bug.organisationId },
    select: { id: true },
  });
  if (!isMember) {
    return { ok: false, error: "You must be a member of this organisation to ask about this issue." };
  }

  try {
    const result = await createSupportThread(user, bug.organisationId, parsed.data.issueId, parsed.data.body);
    if (!result.ok) return result;

    revalidatePath("/inbox");
    revalidateIssue();
    return { ok: true, threadId: result.threadId };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[createSupportThreadAction] error", error);
    return { ok: false, error: "Could not create request. Please try again." };
  }
}

export async function addRequesterMessageAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`support-thread:${user.id}`, ACTION_RATE_LIMITS.supportThread);
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: "Workspace membership required." };

  const parsed = addRequesterMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const result = await addRequesterMessage(user, organisationId, parsed.data.threadId, parsed.data.body);
    if (!result.ok) return result;

    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[addRequesterMessageAction] error", error);
    return { ok: false, error: "Could not send message. Please try again." };
  }
}

export async function takeSupportThreadAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`support-thread:${user.id}`, ACTION_RATE_LIMITS.supportThread);
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: "Workspace membership required." };

  const parsed = takeSupportThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const result = await takeSupportThread(user, organisationId, parsed.data.threadId, parsed.data.agentId);
    if (!result.ok) return result;

    revalidatePath("/inbox");
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[takeSupportThreadAction] error", error);
    return { ok: false, error: "Could not take request. Please try again." };
  }
}

export async function replySupportThreadAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`support-thread:${user.id}`, ACTION_RATE_LIMITS.supportThread);
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: "Workspace membership required." };

  const parsed = replySupportThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const result = await replySupportThread(user, organisationId, parsed.data.threadId, parsed.data.body);
    if (!result.ok) return result;

    revalidatePath("/inbox");
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[replySupportThreadAction] error", error);
    return { ok: false, error: "Could not send reply. Please try again." };
  }
}

export async function releaseSupportThreadAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`support-thread:${user.id}`, ACTION_RATE_LIMITS.supportThread);
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: "Workspace membership required." };

  const parsed = releaseSupportThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const result = await releaseSupportThread(user, organisationId, parsed.data.threadId);
    if (!result.ok) return result;

    revalidatePath("/inbox");
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[releaseSupportThreadAction] error", error);
    return { ok: false, error: "Could not release request. Please try again." };
  }
}

export async function resolveSupportThreadAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`support-thread:${user.id}`, ACTION_RATE_LIMITS.supportThread);
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: "Workspace membership required." };

  const parsed = resolveSupportThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const result = await resolveSupportThread(user, organisationId, parsed.data.threadId);
    if (!result.ok) return result;

    revalidatePath("/inbox");
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[resolveSupportThreadAction] error", error);
    return { ok: false, error: "Could not resolve request. Please try again." };
  }
}

