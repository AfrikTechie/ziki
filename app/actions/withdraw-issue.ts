"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { withdrawIssue } from "@/lib/agent-api/close-suggestions";
import { IssueApiError } from "@/lib/agent-api/errors";
import { ACTION_RATE_LIMITS, consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

/**
 * The issue's reporter or the person it is for withdraws it from its page
 * (#close-reasons): the same core as `POST /api/v1/issues/{id}/withdraw`, so
 * only they may and only while it is not closed or live. It closes with
 * reason `withdrawn`. Returns an error message, or nothing when it worked.
 */
export async function withdrawIssueFromPage(issueId: string): Promise<{ ok?: true; error?: string }> {
  const user = await requireUser();
  const userId = user.id;
  const limit = await consumeRateLimit(`issue-withdraw:${userId}`, ACTION_RATE_LIMITS.addComment);
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };

  const tenantId = await currentTenantIdFor(userId);
  if (!tenantId || typeof issueId !== "string" || !issueId) return { error: "Issue not found" };
  const issue = await prisma.bug.findFirst({
    where: { id: issueId, tenantId, isDeleted: false },
    select: { id: true, projectId: true },
  });
  if (!issue) return { error: "Issue not found" };

  try {
    await withdrawIssue({ tenantId, userId, agentId: null, agentName: null }, issue.projectId, issue.id);
    revalidatePath("/[org]/[project]", "layout");
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    console.error("[issue-withdraw] failed", error);
    return { error: "Could not withdraw the issue. Please try again." };
  }
}

/** The issue page's Withdraw form posts here, with the issue's id in `issueId`. */
export async function withdrawIssueAction(formData: FormData): Promise<void> {
  const issueId = formData.get("issueId");
  await withdrawIssueFromPage(typeof issueId === "string" ? issueId : "");
}
