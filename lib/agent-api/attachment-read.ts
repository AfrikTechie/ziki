import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";

/** Where an agent reads an attachment's bytes with its key (#722). */
export function agentAttachmentUrl(id: string): string {
  return `/api/v1/attachments/${id}`;
}

export type ReadableAttachment = { filename: string; contentType: string; size: number; data: Uint8Array };

/**
 * An attachment an agent may read (#722), or null (the route answers 404, never
 * a login redirect): one on an issue, idea or comment in the agent's organisation
 * that is not deleted, a redesign proposal's in its organisation, or an upload not
 * linked to anything yet when the agent's owner uploaded it.
 */
export async function readableAttachment(agent: Pick<AgentContext, "organisationId" | "ownerId">, id: string): Promise<ReadableAttachment | null> {
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
    },
  });
  if (!attachment) return null;
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
