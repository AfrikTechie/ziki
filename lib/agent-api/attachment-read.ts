import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { agentFindingViewer, canViewFinding } from "@/lib/security-findings";

/** Where an agent reads an attachment's bytes with its key (#722). */
export function agentAttachmentUrl(id: string): string {
  return `/api/v1/attachments/${id}`;
}

export type ReadableAttachment = { filename: string; contentType: string; size: number; data: Uint8Array };

/**
 * An attachment an agent may read (#722), or null (the route answers 404, never
 * a login redirect): one on an issue, idea or comment in the agent's organisation
 * that is not deleted, a redesign proposal's in its organisation, or an upload not
 * linked to anything yet when the agent's owner uploaded it. Evidence on a
 * private security finding only when the agent may see the finding
 * (#security-findings).
 */
export async function readableAttachment(agent: Pick<AgentContext, "agentId" | "organisationId" | "ownerId">, id: string): Promise<ReadableAttachment | null> {
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      uploaderId: true,
      filename: true,
      contentType: true,
      size: true,
      data: true,
      bug: { select: { isDeleted: true, organisationId: true } },
      idea: { select: { isDeleted: true, organisationId: true } },
      comment: { select: { deletedAt: true, bug: { select: { organisationId: true, isDeleted: true } } } },
      redesignProposal: { select: { organisationId: true } },
      securityFinding: { select: { organisationId: true, reporterId: true, disclosedAt: true } },
    },
  });
  if (!attachment) return null;
  if (attachment.securityFinding && !attachment.securityFinding.disclosedAt) {
    if (!canViewFinding(attachment.securityFinding, await agentFindingViewer(agent))) return null;
    return { filename: attachment.filename, contentType: attachment.contentType, size: attachment.size, data: new Uint8Array(attachment.data) };
  }
  const parent = attachment.bug ?? attachment.idea ?? attachment.comment?.bug ?? null;
  if (parent) {
    if (parent.organisationId !== agent.organisationId || parent.isDeleted || attachment.comment?.deletedAt) return null;
  } else if (attachment.redesignProposal) {
    if (attachment.redesignProposal.organisationId !== agent.organisationId) return null;
  } else if (attachment.uploaderId !== agent.ownerId) {
    return null;
  }
  return { filename: attachment.filename, contentType: attachment.contentType, size: attachment.size, data: new Uint8Array(attachment.data) };
}
