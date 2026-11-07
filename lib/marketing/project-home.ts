import type { Prisma, PrismaClient } from "@prisma/client";
import { ideasPath, marketingPath, type ProjectRef } from "@/lib/project-paths";
import { MARKETING_TRACK, PRODUCT_TRACK } from "@/lib/marketing/track";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Whether a project is all marketing (#marketing-home): it has marketing work
 * and no product work, like Ziki's Marketing project. Work is its ideas and its
 * issues (they are kept apart), so a project whose marketing tasks are all
 * still ideas counts. A product project that also has a few marketing tasks
 * is not one.
 */
export async function isMarketingProject(db: Db, projectId: string): Promise<boolean> {
  const marketing = { projectId, isDeleted: false, ...MARKETING_TRACK };
  const product = { projectId, isDeleted: false, ...PRODUCT_TRACK };
  const [marketingIdea, marketingIssue, productIdea, productIssue] = await Promise.all([
    db.idea.findFirst({ where: marketing, select: { id: true } }),
    db.bug.findFirst({ where: marketing, select: { id: true } }),
    db.idea.findFirst({ where: product, select: { id: true } }),
    db.bug.findFirst({ where: product, select: { id: true } }),
  ]);
  return Boolean(marketingIdea || marketingIssue) && !productIdea && !productIssue;
}

/** Where a project opens (`/<org>/<project>`): its Marketing tab when it is all marketing, else its Ideas. */
export async function projectHomePath(db: Db, projectId: string, ref: ProjectRef): Promise<string> {
  return (await isMarketingProject(db, projectId)) ? marketingPath(ref) : ideasPath(ref);
}
