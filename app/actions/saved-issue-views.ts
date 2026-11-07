"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { logger } from "@/lib/logger";
import { MAX_SAVED_ISSUE_VIEWS, savedIssueViewSchema } from "@/lib/saved-issue-views";

export type SavedViewResult = { ok: true } | { error: string };

export async function saveIssueViewAction(org: string, slug: string, input: unknown): Promise<SavedViewResult> {
  const { user, project } = await requireProject(org, slug);
  const parsed = savedIssueViewSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the view details." };
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialize this person's saves so concurrent requests cannot exceed the limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"saved-views:" + user.id + ":" + project.id}))`;
      const where = { userId: user.id, projectId: project.id };
      const existing = await tx.savedIssueView.findFirst({ where: { ...where, name: parsed.data.name } });
      if (existing) return { error: "You already have a view with this name. Choose another name." };
      if (await tx.savedIssueView.count({ where }) >= MAX_SAVED_ISSUE_VIEWS) {
        return { error: "You can save up to 20 views per project. Delete one before adding another." };
      }
      await tx.savedIssueView.create({ data: { ...where, ...parsed.data } });
      return { ok: true as const };
    });
    if ("ok" in result) revalidatePath("/[org]/[project]/issues/[status]", "page");
    return result;
  } catch (error) {
    logger.error("[saved-views] save failed", error);
    return { error: "Could not save this view. Try again." };
  }
}

export async function deleteIssueViewAction(org: string, slug: string, id: string): Promise<SavedViewResult> {
  const { user, project } = await requireProject(org, slug);
  if (typeof id !== "string" || id.length > 100) return { error: "Invalid saved view." };
  try {
    await prisma.savedIssueView.deleteMany({ where: { id, userId: user.id, projectId: project.id } });
    revalidatePath("/[org]/[project]/issues/[status]", "page");
    return { ok: true };
  } catch (error) {
    logger.error("[saved-views] delete failed", error);
    return { error: "Could not delete this view. Try again." };
  }
}
