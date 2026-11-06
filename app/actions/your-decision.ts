"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { agreeWithClose, respondToClose, respondToCloseSchema } from "@/lib/agent-api/close-suggestions";
import { IssueApiError } from "@/lib/agent-api/errors";
import { ACTION_RATE_LIMITS, consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export type DecisionActionResult = { ok?: true; error?: string };

/** The issue in the viewer's workspace, or null. */
async function viewersIssue(userId: string, issueId: string) {
  const tenantId = await currentTenantIdFor(userId);
  if (!tenantId || typeof issueId !== "string" || !issueId) return null;
  const issue = await prisma.bug.findFirst({ where: { id: issueId, tenantId, isDeleted: false }, select: { id: true, projectId: true } });
  return issue ? { tenantId, ...issue } : null;
}

async function run(kind: string, userId: string, fn: () => Promise<unknown>): Promise<DecisionActionResult> {
  const limit = await consumeRateLimit(`issue-decision:${userId}`, ACTION_RATE_LIMITS.addComment);
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };
  try {
    await fn();
    revalidatePath("/[project]", "layout");
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    console.error(`[issue-decision] ${kind} failed`, error);
    return { error: "Something went wrong. Please try again." };
  }
}

/**
 * "Respond" on the decision card (#your-decisions): the issue's
 * owner answers a close by other members' votes with their evidence, posted
 * as a comment the voters are told about (lib/agent-api/close-suggestions.ts,
 * `respondToClose`). The close itself stays as it is.
 */
export async function respondToCloseAction(issueId: string, evidence: string): Promise<DecisionActionResult> {
  const user = await requireUser();
  const parsed = respondToCloseSchema.safeParse({ evidence: typeof evidence === "string" ? evidence.trim() : evidence });
  if (!parsed.success) return { error: "Say why you disagree, with your evidence." };
  const issue = await viewersIssue(user.id, issueId);
  if (!issue) return { error: "Issue not found" };
  return run("respond", user.id, () => respondToClose({ tenantId: issue.tenantId, userId: user.id }, issue.projectId, issue.id, parsed.data));
}

/** "I agree" on the decision card (#your-decisions): the owner accepts the close, and the card folds away. */
export async function agreeWithCloseAction(issueId: string): Promise<DecisionActionResult> {
  const user = await requireUser();
  const issue = await viewersIssue(user.id, issueId);
  if (!issue) return { error: "Issue not found" };
  return run("agree", user.id, () => agreeWithClose({ tenantId: issue.tenantId, userId: user.id }, issue.projectId, issue.id));
}
