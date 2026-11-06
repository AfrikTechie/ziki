"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export type ReviewSkillSubmissionResult =
  | { ok: true }
  | { ok: false; error: string };

/** Super admin approves or rejects a pending skill submission. */
export async function reviewSkillSubmissionAction(
  submissionId: string,
  status: "approved" | "rejected",
  rejectionReason?: string | null,
): Promise<ReviewSkillSubmissionResult> {
  const actor = await requireSuperAdmin();

  const submission = await prisma.skillSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, status: true },
  });

  if (!submission) {
    return { ok: false, error: "Submission not found" };
  }
  if (submission.status !== "pending") {
    return { ok: false, error: "Submission has already been reviewed" };
  }

  await prisma.skillSubmission.update({
    where: { id: submissionId },
    data: {
      status,
      reviewedById: actor.id,
      reviewedAt: new Date(),
      rejectionReason:
        status === "rejected" ? (rejectionReason ?? null) : null,
    },
  });

  revalidatePath("/superadmin/skill-approvals");
  revalidatePath("/skills");
  return { ok: true };
}


