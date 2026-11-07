"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { bugInOrganisation, currentOrganisationIdFor } from "@/lib/organisation-context";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { parseIssueRef } from "@/lib/duplicates";
import { formatIssueNumber } from "@/lib/issue-number";
import { revalidateIssue } from "@/lib/revalidate-issue";
import type { Status, Substatus } from "@prisma/client";
import { wouldCreateBlockerCycle } from "@/lib/issue-blockers";

export type IssueBlockerActionResult = { ok?: true; error?: string };
export type IssueBlockerCandidate = { id: string; number: number; title: string; status: Status; substatus: Substatus };

const FORBIDDEN = "Only an owner or admin of this organization can change issue blockers.";

async function requireOrgAdmin() {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  return access.admin ? { user } : { error: FORBIDDEN };
}

function revalidate() {
  revalidateIssue();
  revalidatePath("/[project]", "layout");
}

/** Link an issue as a prerequisite for this one. */
export async function addIssueBlockerAction(blockedBugId: string, blockerRef: string): Promise<IssueBlockerActionResult> {
  const gate = await requireOrgAdmin();
  if ("error" in gate) return { error: gate.error };
  const organisationId = await currentOrganisationIdFor(gate.user.id);
  if (!organisationId) return { error: "Select an organization first." };
  const ref = parseIssueRef(blockerRef ?? "");
  if (!ref) return { error: "Enter an issue number, like #12." };

  const blocked = await prisma.bug.findFirst({
    where: { id: blockedBugId, ...bugInOrganisation(organisationId), isDeleted: false },
    select: { id: true, number: true, projectId: true },
  });
  if (!blocked) return { error: "This issue no longer exists or was deleted." };
  const blocker = await prisma.bug.findFirst({
    where: { ...bugInOrganisation(organisationId), isDeleted: false, ...("number" in ref ? { number: ref.number } : { id: ref.id }) },
    select: { id: true, number: true, projectId: true },
  });
  if (!blocker) return { error: "That issue doesn't exist or was deleted." };
  if (blocker.id === blocked.id) return { error: "An issue can't block itself." };
  if (blocker.projectId !== blocked.projectId) return { error: "Choose an issue from the same project." };
  if (await prisma.issueBlocker.findUnique({ where: { blockedBugId_blockerBugId: { blockedBugId, blockerBugId: blocker.id } }, select: { id: true } })) {
    return { ok: true };
  }
  if (await wouldCreateBlockerCycle(blocked.id, blocker.id, async (issueIds) => {
    const edges = await prisma.issueBlocker.findMany({
      where: { blockedBugId: { in: issueIds }, blockerBug: { projectId: blocked.projectId } },
      select: { blockerBugId: true },
    });
    return edges.map((edge) => edge.blockerBugId);
  })) return { error: "That link would create a blocker cycle. Choose an issue that does not depend on this one." };

  await prisma.$transaction(async (tx) => {
    await tx.issueBlocker.create({ data: { blockedBugId: blocked.id, blockerBugId: blocker.id } });
    await tx.bugActivity.createMany({ data: [
      { bugId: blocked.id, actorId: gate.user.id, type: "blocker_changed", summary: `marked ${formatIssueNumber(blocked.number)} as blocked by ${formatIssueNumber(blocker.number)}`, metadata: { field: "blockedBy", blockerId: blocker.id, blockerNumber: blocker.number } },
      { bugId: blocker.id, actorId: gate.user.id, type: "blocker_changed", summary: `marked ${formatIssueNumber(blocker.number)} as blocking ${formatIssueNumber(blocked.number)}`, metadata: { field: "blocking", blockedId: blocked.id, blockedNumber: blocked.number } },
    ] });
  });
  revalidate();
  return { ok: true };
}

/** Remove a prerequisite link from either issue's page. */
export async function removeIssueBlockerAction(blockedBugId: string, blockerBugId: string): Promise<IssueBlockerActionResult> {
  const gate = await requireOrgAdmin();
  if ("error" in gate) return { error: gate.error };
  const organisationId = await currentOrganisationIdFor(gate.user.id);
  if (!organisationId) return { error: "Select an organization first." };
  const pair = await prisma.issueBlocker.findFirst({
    where: { blockedBugId, blockerBugId, blockedBug: bugInOrganisation(organisationId), blockerBug: bugInOrganisation(organisationId) },
    select: { blockedBug: { select: { id: true, number: true } }, blockerBug: { select: { id: true, number: true } } },
  });
  if (!pair) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.issueBlocker.deleteMany({ where: { blockedBugId, blockerBugId } });
    await tx.bugActivity.createMany({ data: [
      { bugId: blockedBugId, actorId: gate.user.id, type: "blocker_changed", summary: `cleared the blocker link to ${formatIssueNumber(pair.blockerBug.number)}`, metadata: { field: "blockedBy", blockerId: blockerBugId } },
      { bugId: blockerBugId, actorId: gate.user.id, type: "blocker_changed", summary: `cleared the link blocking ${formatIssueNumber(pair.blockedBug.number)}`, metadata: { field: "blocking", blockedId: blockedBugId } },
    ] });
  });
  revalidate();
  return { ok: true };
}
