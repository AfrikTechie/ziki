"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { isAdmin } from "@/lib/roles";
import {
  correctEntry,
  creditMissingAwards,
  disputeInputSchema,
  grantMissingAward,
  NOT_IN_ORGANISATION,
  NO_ENTRY_ON_THIS_DISPUTE,
  openDispute,
  parseIssueNumbers,
  rejectDispute,
} from "@/lib/points/disputes";

/** Open a dispute, or resolve one as an organisation admin (#436). */

export type DisputeActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: string };

export async function openDisputeAction(
  _previous: DisputeActionResult | undefined,
  formData: FormData,
): Promise<DisputeActionResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: NO_ORGANISATION_MESSAGE };

  const parsed = disputeInputSchema.safeParse({
    bugNumber: formData.get("bugNumber"),
    kind: formData.get("kind"),
    role: formData.get("role") || undefined,
    pointEntryId: formData.get("pointEntryId") || undefined,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Invalid input.",
      field: issue?.path.join("."),
    };
  }

  const result = await openDispute(prisma, {
    organisationId,
    userId: user.id,
    input: parsed.data,
  });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/points/disputes");
  return { ok: true, message: "Dispute opened. An organisation admin will review it." };
}

/**
 * One form, three decisions: grant the missing award, correct an entry, or
 * reject. Only organisation admins may resolve, and only once (#436).
 */
export async function resolveDisputeAction(
  _previous: DisputeActionResult | undefined,
  formData: FormData,
): Promise<DisputeActionResult> {
  const user = await requireUser();

  const disputeId = formData.get("disputeId");
  if (typeof disputeId !== "string" || !disputeId) {
    return { ok: false, error: "Invalid dispute." };
  }

  const dispute = await prisma.pointDispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      organisationId: true,
      userId: true,
      bugId: true,
      pointEntryId: true,
      status: true,
    },
  });
  if (!dispute) return { ok: false, error: "That dispute no longer exists." };

  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId || dispute.organisationId !== organisationId) {
    return { ok: false, error: NOT_IN_ORGANISATION };
  }
  if (!(await canManagePoints(user, dispute.organisationId))) {
    return { ok: false, error: "Only an organisation admin can resolve disputes." };
  }
  if (dispute.userId === user.id) {
    return { ok: false, error: "You cannot resolve your own points dispute." };
  }

  const noteValue = formData.get("note");
  const note = typeof noteValue === "string" ? noteValue : null;
  const decision = formData.get("decision");

  if (decision === "grant") {
    const role = formData.get("role");
    if (role !== "solver" && role !== "reporter") {
      return { ok: false, error: "Pick which award to grant.", field: "role" };
    }
    const bug = await prisma.bug.findUnique({
      where: { id: dispute.bugId },
      select: {
        id: true,
        number: true,
        organisationId: true,
        reporterId: true,
        assigneeId: true,
        projectId: true,
      },
    });
    if (!bug || bug.organisationId !== dispute.organisationId) {
      return { ok: false, error: NOT_IN_ORGANISATION };
    }
    const result = await grantMissingAward(prisma, {
      dispute,
      bug,
      role,
      resolvedById: user.id,
    });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/points/disputes");
    return {
      ok: true,
      message: result.awarded
        ? `Granted the missing ${role} award.`
        : "That award was already in the ledger, so nothing was added twice.",
    };
  }

  if (decision === "correct") {
    if (!dispute.pointEntryId) return { ok: false, error: NO_ENTRY_ON_THIS_DISPUTE };
    const entry = await prisma.pointEntry.findUnique({
      where: { id: dispute.pointEntryId },
      select: { id: true, organisationId: true, userId: true, bugId: true, role: true, points: true, correctedAt: true },
    });
    if (!entry || entry.organisationId !== dispute.organisationId) {
      return { ok: false, error: NOT_IN_ORGANISATION };
    }
    const result = await correctEntry(prisma, {
      dispute,
      entry,
      resolvedById: user.id,
      note,
    });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/points/disputes");
    return {
      ok: true,
      message: "Entry corrected. The original is marked, and a reversing entry was written.",
    };
  }

  if (decision === "reject") {
    const result = await rejectDispute(prisma, { dispute, resolvedById: user.id, note });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/points/disputes");
    return { ok: true, message: "Dispute rejected." };
  }

  return { ok: false, error: "Unknown decision." };
}

/**
 * Site admins were backfilled as ordinary members, so a organisation-admin check
 * alone leaves nobody but a super admin able to repair the ledger.
 */
async function canManagePoints(
  user: { id: string; role?: "user" | "admin" | "super_admin" | null },
  organisationId: string,
): Promise<boolean> {
  return isAdmin(user.role) || isAdminOfOrganisation(user, organisationId);
}

/** Credits solver or reporter awards for the issue numbers an admin names. */
export async function creditAwardsAction(
  _previous: DisputeActionResult | undefined,
  formData: FormData,
): Promise<DisputeActionResult> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false, error: NO_ORGANISATION_MESSAGE };
  if (!(await canManagePoints(user, organisationId))) {
    return { ok: false, error: "Only an organisation admin can credit awards." };
  }

  const role = formData.get("role");
  if (role !== "solver" && role !== "reporter") {
    return { ok: false, error: "Pick which award to credit.", field: "role" };
  }
  const numbers = parseIssueNumbers(String(formData.get("numbers") ?? ""));
  if (numbers.length === 0) {
    return { ok: false, error: "Enter at least one issue number.", field: "numbers" };
  }

  const result = await creditMissingAwards(prisma, { organisationId, numbers, role });
  revalidatePath("/points/disputes");
  revalidatePath("/points");

  const parts: string[] = [];
  if (result.credited.length > 0) {
    parts.push(`Credited ${role} points on ${result.credited.map((n) => `#${n}`).join(", ")}.`);
  }
  if (result.already.length > 0) {
    parts.push(`Already credited: ${result.already.map((n) => `#${n}`).join(", ")}.`);
  }
  if (result.skipped.length > 0) {
    parts.push(
      `Skipped ${result.skipped.map((item) => `#${item.number} (${item.reason})`).join(", ")}.`,
    );
  }
  return { ok: true, message: parts.join(" ") };
}
