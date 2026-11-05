"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { giveRewardEstimate, parseEstimate } from "@/lib/agent-api/reward-estimates";
import { IssueApiError } from "@/lib/agent-api/errors";
import { ACTION_RATE_LIMITS, consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export type RewardEstimateActionResult = {
  ok?: true;
  error?: string;
  reward?: number;
  estimates?: number;
  fixed?: boolean;
  replaced?: boolean;
};

/**
 * A person gives their estimate of an issue's reward on its page (#rewards):
 * a whole $1–$10 and an optional reason. One per person, replaced when given
 * again, until the reward is fixed at 15 estimates.
 */
export async function giveRewardEstimateAction(bugId: string, formData: FormData): Promise<RewardEstimateActionResult> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`reward-estimate:${user.id}`, ACTION_RATE_LIMITS.addComment);
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };

  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId || typeof bugId !== "string" || !bugId) return { error: "Issue not found" };
  const bug = await prisma.bug.findFirst({ where: { id: bugId, tenantId, isDeleted: false }, select: { id: true, projectId: true } });
  if (!bug) return { error: "Issue not found" };

  const reason = String(formData.get("reason") ?? "").trim();
  try {
    const input = parseEstimate({ value: Number(formData.get("value")), ...(reason ? { reason } : {}) });
    const result = await giveRewardEstimate({ userId: user.id, agentId: null }, { tenantId, projectId: bug.projectId }, bug.id, input);
    revalidatePath("/[org]/[project]", "layout");
    revalidateIssue();
    return { ok: true, reward: result.reward, estimates: result.estimates, fixed: result.fixed, replaced: result.replaced };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    console.error("[reward-estimate] failed", error);
    return { error: "Could not save your estimate. Please try again." };
  }
}
