"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { appCookieOptions } from "@/lib/cookie-options";
import { prisma } from "@/lib/prisma";
import { GETTING_STARTED_COOKIE, GETTING_STARTED_COOKIE_MAX_AGE, withDismissed } from "@/lib/onboarding";
import { NEXT_STEP_COOKIE, NEXT_STEP_COOKIE_MAX_AGE } from "@/lib/workspace-next-step";

/** Hide the getting-started checklist for one workspace on this device (#641). */
export async function dismissGettingStartedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;
  const member = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId: user.id } },
    select: { tenantId: true },
  });
  if (!member) return;
  const jar = await cookies();
  jar.set(
    GETTING_STARTED_COOKIE,
    withDismissed(jar.get(GETTING_STARTED_COOKIE)?.value, tenantId),
    appCookieOptions(GETTING_STARTED_COOKIE_MAX_AGE),
  );
  revalidatePath("/[org]/[project]", "layout");
}

/** Hide the next-step card (#agents-dock) for one workspace on this device. */
export async function dismissNextStepAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;
  const member = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId: user.id } },
    select: { tenantId: true },
  });
  if (!member) return;
  const jar = await cookies();
  jar.set(
    NEXT_STEP_COOKIE,
    withDismissed(jar.get(NEXT_STEP_COOKIE)?.value, tenantId),
    appCookieOptions(NEXT_STEP_COOKIE_MAX_AGE),
  );
  revalidatePath("/[project]", "layout");
}
