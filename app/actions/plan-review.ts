"use server";

import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { IssueApiError } from "@/lib/agent-api/errors";
import { approvePlan, ownerStepsSchema, sendBackPlan } from "@/lib/agent-api/plan";
import { revalidateIssue } from "@/lib/revalidate-issue";

export type PlanReviewResult = { ok: true } | { ok: false; error: string };

/**
 * The owner's decisions on a plan (#plan-review), from the issue page only:
 * no agent key approves a plan, its own owner's included, which is what keeps
 * the decision a person's. `approvePlan` and `sendBackPlan` check that the
 * caller is the plan's owner.
 */
async function ownedIssue(bugId: string) {
  const user = await requireUser();
  // By id, whatever organisation the viewer has selected: `plan.ownerId` is the gate (approvePlan, sendBackPlan).
  const bug = await prisma.bug.findFirst({ where: { id: bugId, isDeleted: false }, select: { id: true } });
  return bug ? { user, bug } : null;
}

/** The plan version the owner read, from the form, so a plan the agent changed since is refused (`plan_changed`). */
function planVersion(formData: FormData): string | null {
  const value = String(formData.get("planVersion") ?? "").trim();
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

export async function approvePlanAction(_previous: PlanReviewResult | undefined, formData: FormData): Promise<PlanReviewResult> {
  const bugId = String(formData.get("bugId") ?? "");
  const found = bugId ? await ownedIssue(bugId) : null;
  if (!found) return { ok: false, error: "That issue no longer exists." };
  try {
    await approvePlan({ userId: found.user.id }, found.bug.id, planVersion(formData));
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[plan-review] approve failed", error);
    return { ok: false, error: "Could not approve the plan." };
  }
}

export async function sendBackPlanAction(_previous: PlanReviewResult | undefined, formData: FormData): Promise<PlanReviewResult> {
  const bugId = String(formData.get("bugId") ?? "");
  const note = String(formData.get("note") ?? "");
  const found = bugId ? await ownedIssue(bugId) : null;
  if (!found) return { ok: false, error: "That issue no longer exists." };
  let steps: unknown;
  try {
    steps = JSON.parse(String(formData.get("steps") ?? "[]"));
  } catch {
    return { ok: false, error: "The edited steps could not be read." };
  }
  const parsed = ownerStepsSchema.safeParse(steps);
  if (!parsed.success) return { ok: false, error: "Each step needs some text, and a plan needs at least one step." };
  try {
    await sendBackPlan({ userId: found.user.id }, found.bug.id, { steps: parsed.data, note, expectedVersion: planVersion(formData) });
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[plan-review] send back failed", error);
    return { ok: false, error: "Could not send the plan back." };
  }
}
