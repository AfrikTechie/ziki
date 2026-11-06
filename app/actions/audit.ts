"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { undoAuditEvent } from "@/lib/agent-audit/undo";

export type UndoAuditActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Reverse an audited agent action from the audit page (#450).
 *
 * Only an organisation admin may undo, and only within their own organisation. The undo
 * itself is audited, so nothing is ever silently erased. Failures carry the
 * human-readable message from `undoAuditEvent` so callers can show it directly.
 */
export async function undoAuditEventAction(
  _previous: UndoAuditActionResult | undefined,
  formData: FormData,
): Promise<UndoAuditActionResult> {
  const user = await requireUser();

  const auditEventId = formData.get("auditEventId");
  if (typeof auditEventId !== "string" || !auditEventId) {
    return { ok: false, error: "Invalid audit event." };
  }

  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) {
    return { ok: false, error: "You're not a member of an organisation." };
  }
  if (!(await isAdminOfOrganisation(user, organisationId))) {
    return { ok: false, error: "Only an organisation admin can undo actions." };
  }

  const result = await undoAuditEvent(prisma, {
    auditEventId,
    actorUserId: user.id,
    organisationId,
  });
  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  revalidatePath("/settings/audit");
  return { ok: true, message: "Action undone." };
}
