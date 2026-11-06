"use server";

import { auth } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { resolveIssueWorkspaceSwitch } from "@/lib/issue-workspace-switch";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import { setActiveOrganisationCookie } from "@/lib/organisations";
import { consumeRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type IssueSwitchState = {error?: string};
export async function switchIssueWorkspaceAction(_previous: IssueSwitchState, form: FormData): Promise<IssueSwitchState> {
  if (!(await auth())?.user) redirect(`/login?callbackUrl=${encodeURIComponent(safeCallbackUrl(form.get("returnTo")))}`);
  const user = await requireUser();
  let destination: string;
  try {
    if (!(await consumeRateLimit(`issue-workspace-switch:${user.id}`, {max: 20, windowMs: 60000})).allowed) return {error: "Too many attempts. Please wait a minute and try again."};
    const result = await resolveIssueWorkspaceSwitch(prisma, user.id, {issueId: String(form.get("issueId") ?? ""), organisationId: String(form.get("organisationId") ?? ""), returnTo: form.get("returnTo")});
    if (!result) return {error: "This issue is unavailable or your workspace access has changed. Your workspace was not switched."};
    await setActiveOrganisationCookie(result.organisationId);
    destination = result.destination;
  } catch {
    return {error: "We couldn't switch workspaces. Please try again."};
  }
  revalidatePath("/", "layout");
  redirect(destination);
}
