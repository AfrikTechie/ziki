"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { appCookieOptions } from "@/lib/cookie-options";
import { prisma } from "@/lib/prisma";
import { withDismissed } from "@/lib/onboarding";
import { NEXT_STEP_COOKIE, NEXT_STEP_COOKIE_MAX_AGE } from "@/lib/organisation-next-step";

/** Hide the next-step card (#agents-dock) for one organisation on this device. */
export async function dismissNextStepAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const organisationId = String(formData.get("organisationId") ?? "");
  if (!organisationId) return;
  const member = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId, userId: user.id } },
    select: { organisationId: true },
  });
  if (!member) return;
  const jar = await cookies();
  jar.set(
    NEXT_STEP_COOKIE,
    withDismissed(jar.get(NEXT_STEP_COOKIE)?.value, organisationId),
    appCookieOptions(NEXT_STEP_COOKIE_MAX_AGE),
  );
  revalidatePath("/[project]", "layout");
}
