"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { assertMarketingSettingsAccess, updateMarketingSettings } from "@/lib/marketing/settings";
import { revisionLimitSchema } from "@/lib/workflow-config";
import { marketingPath, projectPath } from "@/lib/project-paths";

export type MarketingSettingsActionResult =
  | { ok: true; revisionLimit: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Server action for updating the marketing settings dials (M-API-6, M-UI-7).
 * Owners and admins only.
 */
export async function updateMarketingSettingsAction(
  _previous: unknown,
  formData: FormData,
): Promise<MarketingSettingsActionResult> {
  const slugOrId = String(formData.get("slug") ?? formData.get("projectId") ?? "").trim();
  if (!slugOrId) {
    return { ok: false, error: "Project slug or id is required." };
  }

  const rawRevisionLimit = formData.get("revisionLimit");
  const parsedLimit = revisionLimitSchema.safeParse(Number(rawRevisionLimit));
  if (!parsedLimit.success) {
    const errorMsg = parsedLimit.error.issues[0]?.message ?? "Invalid revision limit.";
    return {
      ok: false,
      error: errorMsg,
      fieldErrors: { revisionLimit: errorMsg },
    };
  }

  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "Authentication required." };
  }

  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) {
    return { ok: false, error: NO_ORGANISATION_MESSAGE };
  }

  try {
    await assertMarketingSettingsAccess(user, organisationId, "change");
    const updated = await updateMarketingSettings(organisationId, slugOrId, user.id, {
      revisionLimit: parsedLimit.data,
    });

    revalidatePath(marketingPath(updated.ref, "settings"));
    revalidatePath(projectPath(updated.ref, "/settings"));
    return { ok: true, revisionLimit: updated.revisionLimit };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update marketing settings.";
    return { ok: false, error: message };
  }
}
