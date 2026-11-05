"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { startTask, submitTask } from "@/lib/earn/progress";
import { requireEarnAgent } from "@/lib/earn/state";

export type EarnActionResult = { error?: string; message?: string };

/** Starts one task by hand (its number comes with the form); the others stay open. */
export async function startEarnTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  // A task cannot be started until the person's agent is connected.
  await requireEarnAgent(user.id);
  await startTask(prisma, user.id, Number(formData.get("n")));
  revalidatePath("/earn", "layout");
}

/** Sends the earner's own task in for checking, with what they did. */
export async function submitEarnTaskAction(_prev: EarnActionResult, formData: FormData): Promise<EarnActionResult> {
  const user = await requireUser();
  const n = Number(formData.get("n"));
  const proof = typeof formData.get("proof") === "string" ? (formData.get("proof") as string) : "";
  try {
    const result = await submitTask(prisma, user.id, n, proof);
    if (!result.ok) return { error: result.error };
    revalidatePath("/earn", "layout");
    return { message: "Sent. Ziki will check it." };
  } catch (error) {
    console.error("[earn] submit failed", error);
    return { error: "Could not send it. Try again." };
  }
}
