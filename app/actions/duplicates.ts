"use server";

import { revalidatePath } from "next/cache";
import { revalidateIssue } from "@/lib/revalidate-issue";
import type { Status } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bugInTenant, currentTenantIdFor } from "@/lib/tenant-context";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantAccess } from "@/lib/tenant-access";
import { formatIssueNumber } from "@/lib/issue-number";
import { parseIssueRef } from "@/lib/duplicates";
import { DuplicateLinkRefused, linkDuplicate } from "@/lib/duplicate-link";
import { escapeSearchQuery } from "@/lib/search";

export type DuplicateActionResult = { ok?: true; error?: string };

export type DuplicateCandidate = { id: string; number: number; title: string; status: Status };

const DUPLICATE_FORBIDDEN = "Only an owner or admin of this organization can change duplicates.";

/** Duplicate links are an organization power, not a site-wide admin power. */
async function requireOrgAdmin() {
  const user = await requireUser();
  const access = await currentTenantAccess(user.id, user.role);
  if (!access.admin) return { error: DUPLICATE_FORBIDDEN };
  return { user };
}

function revalidate(...bugIds: (string | null | undefined)[]) {
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath("/bugs");
  for (const id of new Set(bugIds)) {
    if (id) {
      revalidateIssue();
      revalidatePath(`/bugs/${id}`);
    }
  }
}

/**
 * Admin only (#285): mark `bugId` as a duplicate of the issue `targetRef`
 * names (#12, 12, an issue link or an id). One level only, and both rows
 * are locked while checking so two admins can't build a chain between
 * them at the same moment.
 */
export async function markDuplicateAction(
  bugId: string,
  targetRef: string,
): Promise<DuplicateActionResult> {
  const gate = await requireOrgAdmin();
  if ("error" in gate) return { error: gate.error };
  const admin = gate.user;
  const ref = parseIssueRef(targetRef ?? "");
  if (!ref) return { error: "Enter an issue number, like #12." };

  // #425: both issues must be in the admin's tenant.
  const tenantId = await currentTenantIdFor(admin.id);
  // #517: a number is only unique within its tenant, so look it up through
  // the composite key rather than the old site-wide `number` key.
  const target = tenantId
    ? await prisma.bug.findUnique({
        where:
          "number" in ref
            ? { tenantId_number: { tenantId, number: ref.number } }
            : { id: ref.id, tenantId },
        select: { id: true },
      })
    : null;
  if (!target) return { error: "That issue doesn't exist." };

  let previous: string | null = null;
  try {
    const linked = await prisma.$transaction((tx) =>
      linkDuplicate(tx, { tenantId: tenantId!, bugId, targetId: target.id, actorId: admin.id }),
    );
    if (!linked.unchanged) previous = linked.previous;
  } catch (error) {
    if (error instanceof DuplicateLinkRefused) return { error: error.message };
    throw error;
  }

  revalidate(bugId, target.id, previous);
  return { ok: true };
}

/** Admin only (#285): the issue is no longer a duplicate; it reappears in the list. */
export async function clearDuplicateAction(bugId: string): Promise<DuplicateActionResult> {
  const gate = await requireOrgAdmin();
  if ("error" in gate) return { error: gate.error };
  const admin = gate.user;
  const bug = await prisma.bug.findUnique({
    where: { id: bugId, ...bugInTenant(await currentTenantIdFor(admin.id)) },
    select: { number: true, duplicateOfId: true, duplicateOf: { select: { id: true, number: true } } },
  });
  if (!bug) return { error: "This issue no longer exists." };
  if (!bug.duplicateOfId) return { ok: true };

  const was = bug.duplicateOf;
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.bug.updateMany({
      where: { id: bugId, duplicateOfId: bug.duplicateOfId },
      data: { duplicateOfId: null },
    });
    if (count === 0) return;
    await tx.bugActivity.createMany({
      data: [
        {
          bugId,
          actorId: admin.id,
          type: "duplicate_changed",
          summary: was
            ? `cleared the duplicate link to ${formatIssueNumber(was.number)}`
            : "cleared the duplicate link",
          metadata: { field: "duplicateOf", from: bug.duplicateOfId, to: null },
        },
        ...(was
          ? [
              {
                bugId: was.id,
                actorId: admin.id,
                type: "duplicate_changed" as const,
                summary: `cleared ${formatIssueNumber(bug.number)} as a duplicate of this issue`,
                metadata: { field: "duplicates", from: bugId },
              },
            ]
          : []),
      ],
    });
  });

  revalidate(bugId, was?.id);
  return { ok: true };
}

/**
 * Admin only: issues `bugId` could be marked a duplicate of, for the
 * picker. Live, not itself a duplicate, not this issue.
 */
export async function findDuplicateCandidatesAction(
  bugId: string,
  query: string,
): Promise<DuplicateCandidate[]> {
  const gate = await requireOrgAdmin();
  if ("error" in gate) return [];
  const admin = gate.user;
  const text = (query ?? "").trim().slice(0, 200);
  if (!text) return [];
  const ref = parseIssueRef(text);
  const base = {
    ...bugInTenant(await currentTenantIdFor(admin.id)),
    isDeleted: false,
    duplicateOfId: null,
    NOT: { id: bugId },
  };
  const where =
    ref && "number" in ref
      ? { ...base, OR: [{ number: ref.number }, { title: { contains: escapeSearchQuery(text), mode: "insensitive" as const } }] }
      : ref && "id" in ref
        ? { ...base, id: ref.id }
        : text.length >= 2
          ? { ...base, title: { contains: escapeSearchQuery(text), mode: "insensitive" as const } }
          : null;
  if (!where) return [];
  return prisma.bug.findMany({
    where,
    select: { id: true, number: true, title: true, status: true },
    orderBy: [{ voteCount: "desc" }, { number: "desc" }],
    take: 6,
  });
}
