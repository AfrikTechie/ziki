"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { EARN_ORGANISATION_SLUG } from "@/lib/earn/draft";
import { confirmTask, rejectTask } from "@/lib/earn/progress";

export type EarnReviewResult = { error?: string; message?: string };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Staff confirm a submitted earn task: it is marked confirmed and the earner is paid. */
export async function confirmEarnTaskAction(_prev: EarnReviewResult, formData: FormData): Promise<EarnReviewResult> {
  const staff = await requireSuperAdmin();
  try {
    const result = await confirmTask(prisma, {
      userId: field(formData, "userId"),
      taskKey: field(formData, "taskKey"),
      staffId: staff.id,
      earnOrganisationSlug: EARN_ORGANISATION_SLUG,
      note: field(formData, "note"),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath("/superadmin/earn");
    revalidatePath("/earn", "layout");
    return { message: "Confirmed and paid." };
  } catch (error) {
    console.error("[superadmin/earn] confirm failed", error);
    return { error: "Could not confirm it. Nothing was paid." };
  }
}

/** Staff send a submitted earn task back with a reason. */
export async function rejectEarnTaskAction(_prev: EarnReviewResult, formData: FormData): Promise<EarnReviewResult> {
  const staff = await requireSuperAdmin();
  try {
    const result = await rejectTask(prisma, {
      userId: field(formData, "userId"),
      taskKey: field(formData, "taskKey"),
      staffId: staff.id,
      reason: field(formData, "reason"),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath("/superadmin/earn");
    revalidatePath("/earn", "layout");
    return { message: "Sent back." };
  } catch (error) {
    console.error("[superadmin/earn] reject failed", error);
    return { error: "Could not send it back." };
  }
}
