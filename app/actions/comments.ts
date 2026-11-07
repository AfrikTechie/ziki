"use server";

import { revalidatePath } from "next/cache";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bugInOrganisation, commentInOrganisation, currentOrganisationIdFor } from "@/lib/organisation-context";
import { currentOrganisationAccess, organisationAccessFor } from "@/lib/organisation-access";
import { attachmentIdsInMarkdown, linkAttachments } from "@/lib/attachment-link";
import { requireUser } from "@/lib/auth-helpers";
import { commentSchema } from "@/lib/validations/issue";
import {
  extractMentionedUserIds,
  newlyMentionedAgentIds,
  newlyMentionedUserIds,
  normalizeMentions,
} from "@/lib/mentions";
import { agentMentionNames, agentOwnerIds, mentionedAgents } from "@/lib/agent-mentions";
import { organisationMemberWhere } from "@/lib/organisation-mentions";
import {
  canDeleteComment,
  canEditComment,
  COMMENT_ERRORS,
} from "@/lib/comment-permissions";
import {
  commentDeletedSummary,
  commentedSummary,
  commentPreview,
} from "@/lib/activity-log";
import { notifyLater } from "@/lib/notify";
import {
  consumeRateLimit,
  ACTION_RATE_LIMITS,
  RATE_LIMIT_MESSAGE,
} from "@/lib/rate-limit";
import { publishWebEvent } from "@/lib/agent-api/web-events";
import { castCommentVote } from "@/lib/agent-api/comment-votes";
import { IssueApiError } from "@/lib/agent-api/errors";
import { checkPostForSecrets } from "@/lib/security/secret-guard";

export type CommentActionResult = { error?: string; ok?: boolean };

async function loadComment(commentId: unknown, user: { id: string; role?: string | null }) {
  if (typeof commentId !== "string" || commentId.trim().length === 0) return null;
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      bugId: true,
      authorId: true,
      body: true,
      deletedAt: true,
      author: { select: { name: true } },
      bug: { select: { isDeleted: true, title: true, organisationId: true, projectId: true } },
    },
  });
  if (!comment) return null;
  if (user.role === "super_admin") return comment;
  const canAccess = Boolean(
    await prisma.projectMembership.findFirst({
      where: { projectId: comment.bug.projectId, userId: user.id },
      select: { id: true },
    }) ||
    await prisma.membership.findFirst({
      where: { organisationId: comment.bug.organisationId, userId: user.id },
      select: { id: true },
    })
  );
  if (!canAccess) return null;
  return comment;
}

/** Edit a comment's body. Authors only; mentions are re-verified (#150). */
export async function updateCommentAction(
  commentId: string,
  formData: FormData,
): Promise<CommentActionResult> {
  const user = await requireUser();

  const limit = await consumeRateLimit(
    `edit-comment:${user.id}`,
    ACTION_RATE_LIMITS.editComment,
  );
  if (!limit.allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const comment = await loadComment(commentId, user);
  if (!comment) return { error: COMMENT_ERRORS.notFound };
  if (comment.bug.isDeleted) return { error: COMMENT_ERRORS.issueDeleted };
  if (comment.deletedAt) return { error: COMMENT_ERRORS.deleted };
  if (!canEditComment(user.id, comment)) return { error: COMMENT_ERRORS.notAuthor };

  const parsed = commentSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid comment" };
  }

  // #secret-protection: an edit is a post too.
  const secrets = await checkPostForSecrets({
    organisationId: comment.bug.organisationId,
    projectId: comment.bug.projectId,
    actor: { kind: "user", userId: user.id },
    source: "comment",
    bugId: comment.bugId,
    commentId: comment.id,
    fields: { body: parsed.data.body },
    noun: "this comment",
  });
  if (!secrets.ok) return { error: secrets.message };

  const mentionedIds = extractMentionedUserIds(parsed.data.body);
  const known = mentionedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: mentionedIds }, ...organisationMemberWhere(comment.bug.organisationId) },
        select: { id: true, name: true },
      })
    : [];
  // #603: agent tags survive only for agents in this issue's organisation.
  const agents = await mentionedAgents(prisma, comment.bug.organisationId, parsed.data.body);
  const body = normalizeMentions(
    parsed.data.body,
    new Map([
      ...known.map((u) => [u.id, u.name] as [string, string]),
      ...agentMentionNames(agents),
    ]),
  );

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.comment.updateMany({
      where: { id: comment.id, deletedAt: null },
      data: { body, editedAt: new Date() },
    });
    if (updated.count === 0) {
      return { error: COMMENT_ERRORS.deleted };
    }
    // Images pasted while editing (#305).
    await linkAttachments(tx, {
      ids: attachmentIdsInMarkdown(body),
      uploaderId: user.id,
      bugId: comment.bugId,
      commentId: comment.id,
    });

    await tx.bugActivity.updateMany({
      where: {
        bugId: comment.bugId,
        type: "commented",
        metadata: { path: ["commentId"], equals: comment.id },
      },
      data: {
        summary: commentedSummary(body),
        metadata: {
          field: "comment",
          commentId: comment.id,
          commentPreview: commentPreview(body),
        } as Prisma.InputJsonValue,
      },
    });
    // #600: agents following the thread see the edit.
    await publishWebEvent(tx, {
      bugId: comment.bugId,
      type: "comment.edited",
      actorUserId: user.id,
      payload: { commentId: comment.id, authorId: comment.authorId },
    });

    return { ok: true as const };
  });

  if (result.error) {
    return result;
  }

  const newlyMentionedAgents = new Set(newlyMentionedAgentIds(comment.body, body));
  const newlyMentioned = [
    ...new Set([
      ...newlyMentionedUserIds(comment.body, body),
      ...agentOwnerIds(agents.filter((agent) => newlyMentionedAgents.has(agent.id))),
    ]),
  ];
  if (newlyMentioned.length > 0) {
    notifyLater({
      kind: "mentioned",
      actorId: user.id,
      actorName: user.name ?? "Someone",
      bugId: comment.bugId,
      bugTitle: comment.bug.title,
      place: "comment",
      commentId: comment.id,
      recipientIds: newlyMentioned,
      excerpt: commentPreview(body),
    });
  }

  revalidateIssue();
  revalidatePath(`/bugs/${comment.bugId}`);
  return { ok: true };
}

/**
 * Soft-delete a comment: the body is cleared, replies stay in place and the
 * thread shows "This comment was deleted". Authors and admins only. When an
 * admin removes someone else's comment it is logged in the activity timeline,
 * and the comment's text is removed from the "added a comment" log entry.
 */
export async function deleteCommentAction(
  commentId: string,
): Promise<CommentActionResult> {
  const user = await requireUser();
  const comment = await loadComment(commentId, user);
  if (!comment) return { error: COMMENT_ERRORS.notFound };
  if (comment.bug.isDeleted) return { error: COMMENT_ERRORS.issueDeleted };
  if (comment.deletedAt) return { error: COMMENT_ERRORS.deleted };
  const access = await organisationAccessFor(user.id, comment.bug.organisationId, user.role);
  if (!canDeleteComment(user.id, user.role, comment, access.admin)) {
    return { error: COMMENT_ERRORS.cannotDelete };
  }

  const isModeration = comment.authorId !== user.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.comment.updateMany({
        where: { id: comment.id, deletedAt: null },
        data: { body: "", deletedAt: new Date() },
      });
      if (updated.count === 0) {
        return { error: COMMENT_ERRORS.deleted };
      }
      // A deleted comment's files go too, e.g. a screenshot posted by mistake (#215).
      await tx.attachment.deleteMany({ where: { commentId: comment.id } });

      // Scrub the text preview from the activity entry that recorded it.
      await tx.bugActivity.updateMany({
        where: {
          bugId: comment.bugId,
          type: "commented",
          metadata: { path: ["commentId"], equals: comment.id },
        },
        data: {
          summary: "added a comment (since deleted)",
          metadata: { field: "comment", commentId: comment.id } as Prisma.InputJsonValue,
        },
      });

      if (isModeration) {
        await tx.bugActivity.create({
          data: {
            bugId: comment.bugId,
            actorId: user.id,
            type: "comment_deleted",
            summary: commentDeletedSummary(comment.author.name),
            metadata: { field: "comment", commentId: comment.id } as Prisma.InputJsonValue,
          },
        });
      }
      await publishWebEvent(tx, {
        bugId: comment.bugId,
        type: "comment.deleted",
        actorUserId: user.id,
        payload: { commentId: comment.id, authorId: comment.authorId, moderated: isModeration },
      });

      return { ok: true as const };
    });

    if ("error" in result) {
      return result;
    }
  } catch (error) {
    console.error("Failed to delete comment:", error);
    return { error: COMMENT_ERRORS.failed };
  }

  revalidateIssue();
  revalidatePath(`/bugs/${comment.bugId}`);
  return { ok: true };
}

export type UpvoteCommentResult = { error?: string; ok?: boolean; votes?: number };

/**
 * Upvote a helpful comment on an issue, as the signed-in person
 * (#comment-votes). The same rule as the agent route: one vote per person per
 * comment, never your own, and each new vote pays the comment's author 1
 * point. Voting again is fine and counts once.
 */
export async function upvoteCommentAction(commentId: string): Promise<UpvoteCommentResult> {
  const user = await requireUser();
  if (typeof commentId !== "string" || commentId.trim().length === 0) return { error: COMMENT_ERRORS.notFound };

  const limit = await consumeRateLimit(`upvote-comment:${user.id}`, ACTION_RATE_LIMITS.toggleVote);
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };

  try {
    const result = await castCommentVote({
      commentId,
      bugScope: bugInOrganisation(await currentOrganisationIdFor(user.id)),
      voterUserId: user.id,
      agentId: null,
    });
    revalidateIssue();
    revalidatePath(`/bugs/${result.bugId}`);
    return { ok: true, votes: result.votes };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    console.error("Failed to upvote comment:", error);
    return { error: "Could not upvote the comment. Try again." };
  }
}
