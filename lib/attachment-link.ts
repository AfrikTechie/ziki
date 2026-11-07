import type { Prisma, PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "attachment"> | Pick<Prisma.TransactionClient, "attachment">;

/** Most files one description or comment links by reference. */
export const MAX_REFERENCED_ATTACHMENTS = 20;

/**
 * Attachment ids referenced from Markdown as `/api/attachments/<id>`, for
 * images pasted or dropped into the editor (#305). Linking them on save is
 * what lets other readers see them; until then only the uploader can.
 */
export function attachmentIdsInMarkdown(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids = [...text.matchAll(/\/api\/attachments\/([a-z0-9]{8,40})\b/gi)].map((m) => m[1]);
  return [...new Set(ids)].slice(0, MAX_REFERENCED_ATTACHMENTS);
}

/**
 * What a file is attached to: an issue (and maybe one of its comments or
 * confirmation entries), an idea (#idea-table), or a private security finding
 * (#security-findings), whose files only the people who may see it can read.
 */
export type AttachmentTarget =
  | { bugId: string; commentId?: string | null; confirmationId?: string | null }
  | { ideaId: string }
  | { securityFindingId: string };

/**
 * Links freshly uploaded files to the issue, comment or idea being saved (#215).
 * Only the uploader's own, not-yet-linked files can be claimed, so nobody can
 * attach - or steal - someone else's upload by guessing its id.
 */
export async function linkAttachments(
  db: Db,
  { ids, uploaderId, ...target }: { ids: string[]; uploaderId: string } & AttachmentTarget,
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.attachment.updateMany({
    where: { id: { in: ids }, uploaderId, bugId: null, ideaId: null, commentId: null, confirmationId: null, securityFindingId: null },
    data:
      "securityFindingId" in target
        ? { securityFindingId: target.securityFindingId }
        : "ideaId" in target
          ? { ideaId: target.ideaId }
          : { bugId: target.bugId, commentId: target.commentId ?? null, confirmationId: target.confirmationId ?? null },
  });
  return result.count;
}
