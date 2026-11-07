"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { createTakeItBack } from "@/lib/take-it-back-server";

export type TakeItBackResult =
  | { ok: true; issueNumber: number }
  | { ok: false; error: string };

/**
 * "Take it back" (#851). Only an organisation owner or admin may call this;
 * the check is repeated inside the transaction. On success the owner lands on
 * the revert issue, which then follows the normal lifecycle.
 */
export async function takeItBackAction(
  _previous: TakeItBackResult | undefined,
  formData: FormData,
): Promise<TakeItBackResult> {
  const user = await requireUser();
  const issueId = String(formData.get("issueId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!issueId) return { ok: false, error: "No such issue." };

  const result = await createTakeItBack({
    issueId,
    userId: user.id,
    userRole: user.role,
    reason,
  });
  if (!result.ok) return result;

  revalidateIssue();
  redirect(result.href);
}
