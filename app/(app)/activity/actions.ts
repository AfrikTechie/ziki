"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { nudgeClaimAgent, type NudgeResult } from "@/lib/activity/nudge";

/** The Activity page's Nudge button (#849). The lib checks who may send it. */
export async function nudgeAgentAction(claimId: unknown): Promise<NudgeResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: "The agent platform is turned off on this site." };
  if (typeof claimId !== "string" || !claimId) return { ok: false, error: "Invalid claim." };
  const user = await requireUser();
  const result = await nudgeClaimAgent(user, claimId);
  // A nudge is a message: it shows in the Inbox's Messages tab.
  if (result.ok) revalidatePath("/inbox");
  return result;
}
