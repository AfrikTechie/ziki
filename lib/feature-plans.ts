import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { prisma } from "@/lib/prisma";
import type { SessionAppUser } from "@/lib/auth-helpers";
import { canContributeToProject } from "@/lib/project-permissions";
import { publish } from "@/lib/agent-api/events";
import { projectPath, refOf } from "@/lib/project-paths";
import { featureDraftSchema, featureIdeaDescription, featureRequestSchema, type FeatureDraft, type FeatureRequest, type FeatureScope } from "@/lib/validations/feature-plan";
import type { FeatureContext, FeatureWork } from "@/lib/feature-plan-generation";

export class FeaturePlanError extends Error {}
const STALE = "This plan changed in another tab. Reload it before continuing.";

/** All entry points check the explicit project's membership; a public page is not write access. */
export async function featureProject(user: SessionAppUser, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, archivedAt: null, organisation: { archivedAt: null } },
    select: { id: true, name: true, slug: true, goal: true, organisationId: true, organisation: { select: { slug: true } } },
  });
  if (!project || !await canContributeToProject(user, project.id, project.organisationId)) {
    throw new FeaturePlanError("Project not found or membership required.");
  }
  return project;
}

/** Bounded, project-scoped suggestions. No claim is made about unseen code or the entire backlog. */
export async function findFeatureWork(user: SessionAppUser, projectId: string, query: string): Promise<FeatureWork[]> {
  const project = await featureProject(user, projectId);
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])]
    .filter((word) => !["the", "and", "for", "with", "that", "this", "want", "users", "feature", "should", "have", "can"].includes(word))
    .slice(0, 8);
  if (!words.length) return [];
  const text = { OR: words.flatMap((word) => [
    { title: { contains: word, mode: "insensitive" as const } },
    { description: { contains: word, mode: "insensitive" as const } },
  ]) };
  const scope = { projectId, organisationId: project.organisationId, isDeleted: false, track: "product" as const };
  const [ideas, issues] = await Promise.all([
    prisma.idea.findMany({ where: { ...scope, ...text }, select: { id: true, number: true, title: true, description: true, status: true }, orderBy: { updatedAt: "desc" }, take: 12 }),
    prisma.bug.findMany({ where: { ...scope, ...text }, select: { id: true, number: true, title: true, description: true, status: true, substatus: true }, orderBy: { updatedAt: "desc" }, take: 12 }),
  ]);
  return [
    ...ideas.map((idea) => ({ ref: `idea:${idea.id}`, number: idea.number, title: idea.title, description: idea.description.slice(0, 600), state: `Idea · ${idea.status}` })),
    ...issues.map((issue) => ({ ref: `issue:${issue.id}`, number: issue.number, title: issue.title, description: issue.description.slice(0, 600), state: `Issue · ${issue.status} · ${issue.substatus}` })),
  ];
}

export async function featureContext(user: SessionAppUser, projectId: string, request: FeatureRequest): Promise<FeatureContext> {
  const project = await featureProject(user, projectId);
  const [brief, notes, work] = await Promise.all([
    prisma.projectBrief.findUnique({ where: { projectId }, select: { product: true, audience: true, currentFocus: true, outOfScope: true } }),
    prisma.projectNotes.findUnique({ where: { projectId }, select: { body: true } }),
    findFeatureWork(user, projectId, `${request.title} ${request.request}`),
  ]);
  return { project: project.name, goal: project.goal, brief, notes: notes?.body.slice(0, 6000) ?? null, work };
}

export async function createFeaturePlan(user: SessionAppUser, projectId: string, id: string, request: FeatureRequest, draft: FeatureDraft) {
  await featureProject(user, projectId);
  const validRequest = featureRequestSchema.parse(request);
  const validDraft = featureDraftSchema.parse(draft);
  // A stable client request id makes a lost save response safe to retry.
  const plan = await prisma.featurePlan.upsert({
    where: { id, projectId, creatorId: user.id },
    create: { id, projectId, creatorId: user.id, ...validRequest, draft: validDraft },
    update: {},
    select: { id: true, version: true, title: true, request: true, draft: true },
  });
  if (plan.title !== validRequest.title || plan.request !== validRequest.request || !isDeepStrictEqual(plan.draft, validDraft)) {
    throw new FeaturePlanError("This draft was already saved. Open it from Feature plans to edit it; copy any unsaved changes in this form first.");
  }
  return { id: plan.id, version: plan.version };
}

async function ownedPlan(tx: Prisma.TransactionClient, userId: string, projectId: string, id: string, expectedVersion: number) {
  await tx.$queryRaw`SELECT "id" FROM "FeaturePlan" WHERE "id" = ${id} AND "projectId" = ${projectId} AND "creatorId" = ${userId} FOR UPDATE`;
  const plan = await tx.featurePlan.findFirst({ where: { id, projectId, creatorId: userId } });
  if (!plan) throw new FeaturePlanError("Feature plan not found.");
  if (plan.version !== expectedVersion) throw new FeaturePlanError(STALE);
  return plan;
}

export async function saveFeaturePlan(user: SessionAppUser, projectId: string, id: string, expectedVersion: number, request: FeatureRequest, draft: FeatureDraft) {
  await featureProject(user, projectId);
  const validRequest = featureRequestSchema.parse(request);
  const validDraft = featureDraftSchema.parse(draft);
  return prisma.$transaction(async (tx) => {
    const plan = await ownedPlan(tx, user.id, projectId, id, expectedVersion);
    if (plan.publishedAt) throw new FeaturePlanError("Published plans keep their original scope. Create another plan for a changed feature.");
    return tx.featurePlan.update({ where: { id }, data: { ...validRequest, draft: validDraft, version: { increment: 1 } }, select: { id: true, version: true } });
  });
}

/** First and Later publish separately; the plan row lock and receipts make both retry-safe. */
export async function publishFeaturePlan(user: SessionAppUser, projectId: string, id: string, expectedVersion: number, scope: FeatureScope) {
  const project = await featureProject(user, projectId);
  return prisma.$transaction(async (tx) => {
    const plan = await ownedPlan(tx, user.id, projectId, id, expectedVersion);
    const draft = featureDraftSchema.parse(plan.draft);
    if (scope === "later" && !plan.publishedAt) throw new FeaturePlanError("Publish the first version before the later improvements.");
    const receipts = await tx.featurePlanItem.findMany({ where: { planId: id }, select: { position: true } });
    const published = new Set(receipts.map((item) => item.position));
    const selected = draft.tasks.map((task, position) => ({ task, position }))
      .filter(({ task, position }) => task.scope === scope && !published.has(position));
    // Resolve every reference before creating anything, including after generation or a long-lived draft.
    const links: Array<{ position: number; ideaId: string | null; bugId: string | null }> = [];
    for (const { task, position } of selected) {
      if (!task.existing) continue;
      const [kind, targetId] = task.existing.split(":");
      const where = { id: targetId, projectId, organisationId: project.organisationId, isDeleted: false, track: "product" as const };
      const target = kind === "idea"
        ? await tx.idea.findFirst({ where, select: { id: true } })
        : await tx.bug.findFirst({ where, select: { id: true } });
      if (!target) throw new FeaturePlanError(`The existing work linked to “${task.title}” is no longer available in this project. Nothing was published.`);
      links.push({ position, ideaId: kind === "idea" ? target.id : null, bugId: kind === "issue" ? target.id : null });
    }
    let created = 0;
    const planUrl = projectPath(refOf(project), `/features/${id}`);
    for (const { task, position } of selected) {
      let link = links.find((item) => item.position === position);
      if (!link) {
        const idea = await tx.idea.create({
          data: {
            projectId, organisationId: project.organisationId, reporterId: user.id, beneficiaryUserId: user.id,
            title: task.title, description: featureIdeaDescription(plan, draft, position, planUrl), track: "product",
          },
          select: { id: true, number: true },
        });
        await publish(tx, {
          organisationId: project.organisationId, projectId, type: "idea.created",
          payload: { ideaId: idea.id, ideaNumber: idea.number, projectId, reporterId: user.id, beneficiaryUserId: user.id,
            actor: { kind: "user", id: user.id, name: user.name ?? null } },
        });
        link = { position, ideaId: idea.id, bugId: null };
        created++;
      }
      await tx.featurePlanItem.create({ data: { planId: id, ...link } });
    }
    if (selected.length && !plan.publishedAt) await tx.featurePlan.update({ where: { id }, data: { publishedAt: new Date() } });
    return { created, linked: selected.length - created, replayed: selected.length === 0 };
  }, { timeout: 20_000 });
}

/** Live state only. Delivery, merge and deployment remain distinct; deleted work stays visible as unavailable. */
export function featureWorkState(item: {
  idea: { isDeleted: boolean; status: string; issue: { isDeleted: boolean; status: string; substatus: string } | null } | null;
  bug: { isDeleted: boolean; status: string; substatus: string } | null;
}) {
  const issue = item.bug ?? (!item.idea?.isDeleted ? item.idea?.issue : null);
  if (issue && !issue.isDeleted) return { kind: "issue" as const, status: issue.status, substatus: issue.substatus };
  if (item.idea && !item.idea.isDeleted && !item.idea.issue) return { kind: "idea" as const, status: item.idea.status, substatus: null };
  return { kind: "unavailable" as const, status: "unavailable", substatus: null };
}
