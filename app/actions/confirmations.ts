"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { giveConfirmation, parseConfirmation } from "@/lib/agent-api/confirmations";
import { IssueApiError } from "@/lib/agent-api/errors";
import { parseEvidenceFileLines } from "@/lib/agent-api/evidence-files";
import { ACTION_RATE_LIMITS, consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export type ConfirmationActionResult = {
  ok?: true;
  error?: string;
  /** True when this replaced the person's earlier entry. */
  replaced?: boolean;
  confirmed?: boolean;
  confirmations?: number;
  confirmationsNeeded?: number;
};

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * A person gives an issue at Requires confirmation their confirmation entry
 * from the web app (#issue-confirmations): confirm, reject or neutral, a
 * summary of two sentences at most and a full description; "duplicate of #"
 * on reject. A newer entry replaces their earlier one.
 */
export async function giveConfirmationAction(
  bugId: string,
  formData: FormData,
): Promise<ConfirmationActionResult> {
  const user = await requireUser();
  const userId = user.id;

  const limit = await consumeRateLimit(`confirmation:${userId}`, ACTION_RATE_LIMITS.addComment);
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };

  const tenantId = await currentTenantIdFor(userId);
  if (!tenantId || typeof bugId !== "string" || !bugId) return { error: "Issue not found" };

  const bug = await prisma.bug.findFirst({
    where: { id: bugId, tenantId, isDeleted: false },
    select: { id: true, projectId: true },
  });
  if (!bug) return { error: "Issue not found" };

  const verdict = field(formData, "verdict");
  const files = parseEvidenceFileLines(field(formData, "files") ?? "");
  const body = {
    verdict,
    summary: formData.get("summary") ?? "",
    description: formData.get("description") ?? "",
    ...(verdict === "reject" && field(formData, "duplicateOfId") ? { duplicateOfId: field(formData, "duplicateOfId") } : {}),
    ...(files.length ? { files } : {}),
  };

  try {
    const input = parseConfirmation(body);
    const given = await giveConfirmation({ tenantId, userId }, { tenantId, projectId: bug.projectId }, bug.id, input);
    revalidatePath("/[org]/[project]", "layout");
    revalidateIssue();
    return {
      ok: true,
      replaced: given.replaced,
      confirmed: given.confirmed,
      confirmations: given.confirmations,
      confirmationsNeeded: given.confirmationsNeeded,
    };
  } catch (error) {
    if (error instanceof IssueApiError) {
      return { error: error.status === 400 && error.body?.field === "verdict" ? "Pick confirm, reject or neutral." : error.message };
    }
    console.error("[confirmation] failed", error);
    return { error: "Could not save your confirmation. Please try again." };
  }
}
