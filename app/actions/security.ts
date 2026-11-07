"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess, organisationAccessFor } from "@/lib/organisation-access";
import { discloseFinding } from "@/lib/security-findings";

/**
 * Security findings (#security-findings): the two decisions only a workspace
 * owner or admin makes. Disclosing a finding before its fix is live, and
 * clearing an agent to read private findings.
 */

export type SecurityActionResult = { ok?: boolean; error?: string };

const NOT_ALLOWED = "Only this workspace's owners and admins can do that.";

/** Publishes a private finding now, instead of waiting for its fix to go live. */
export async function discloseFindingAction(findingId: string): Promise<SecurityActionResult> {
  const user = await requireUser();
  const finding = await prisma.securityFinding.findUnique({
    where: { id: findingId },
    select: { id: true, organisationId: true, bugId: true, ideaId: true, disclosedAt: true },
  });
  if (!finding) return { error: "That finding no longer exists." };
  const access = await organisationAccessFor(user.id, finding.organisationId, user.role);
  if (!access.admin) return { error: NOT_ALLOWED };
  if (finding.disclosedAt) return { ok: true };
  await prisma.$transaction((tx) => discloseFinding(tx, finding.id, user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Lets an agent active in this organisation read its private findings, or takes that away. */
export async function setAgentSecurityClearanceAction(agentId: string, cleared: boolean): Promise<SecurityActionResult> {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId || !access.admin) return { error: NOT_ALLOWED };
  const activation = await prisma.agentActivation.findUnique({
    where: { agentId_organisationId: { agentId, organisationId: access.organisationId } },
    select: { id: true, deactivatedAt: true, agent: { select: { revokedAt: true } } },
  });
  if (!activation || activation.deactivatedAt || activation.agent.revokedAt) return { error: "That agent is not active in this organisation." };
  await prisma.agentActivation.update({ where: { id: activation.id }, data: { securityCleared: cleared } });
  revalidatePath("/security");
  return { ok: true };
}
