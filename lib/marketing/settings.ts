import type { Prisma } from "@prisma/client";
import { IssueApiError } from "@/lib/agent-api/errors";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { prisma } from "@/lib/prisma";
import { refOf, type ProjectRef } from "@/lib/project-paths";
import type { AppRole } from "@/lib/roles";
import { updateMarketingSettingsSchema } from "@/lib/validations/marketing";
import { invalidateWorkflow, workflowFor } from "@/lib/workflow";

export type MarketingSettingsResult = {
  projectId: string;
  slug: string;
  ref: ProjectRef;
  name: string;
  revisionLimit: number;
};

/**
 * Check whether an actor (user or agent owner) is an admin/owner of the organisation.
 * Throws IssueApiError(403) if not allowed.
 */
export async function assertMarketingSettingsAccess(
  actor: { id: string; role?: AppRole | null },
  organisationId: string,
  mode: "view" | "change" = "change",
): Promise<void> {
  const allowed = await isAdminOfOrganisation({ id: actor.id, role: actor.role ?? null }, organisationId);
  if (!allowed) {
    throw new IssueApiError(
      403,
      mode === "view"
        ? "Only organisation owners and admins can view marketing settings."
        : "Only organisation owners and admins can change marketing settings.",
    );
  }
}

/**
 * Read the marketing settings dials for one project (M-API-6).
 * Resolves by project ID or slug within the organisation.
 */
export async function getMarketingSettings(
  organisationId: string,
  projectIdOrSlug: string,
): Promise<MarketingSettingsResult> {
  const project = await prisma.project.findFirst({
    where: {
      organisationId,
      OR: [{ id: projectIdOrSlug }, { slug: projectIdOrSlug }],
    },
    select: { id: true, slug: true, name: true, organisation: { select: { slug: true } } },
  });
  if (!project) throw new IssueApiError(404, "Project not found.");

  const workflow = await workflowFor(project.id);
  return {
    projectId: project.id,
    slug: project.slug,
    ref: refOf(project),
    name: project.name,
    revisionLimit: workflow.revisionLimit,
  };
}

/**
 * Update the marketing settings dials for one project (M-API-6).
 * Organisation owners/admins only. Audits changes and invalidates workflow cache.
 */
export async function updateMarketingSettings(
  organisationId: string,
  projectIdOrSlug: string,
  actorUserId: string,
  rawInput: unknown,
): Promise<MarketingSettingsResult> {
  const parsed = updateMarketingSettingsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new IssueApiError(400, parsed.error.issues[0]?.message ?? "Invalid marketing settings.", {
      details: parsed.error.issues,
    });
  }

  const project = await prisma.project.findFirst({
    where: {
      organisationId,
      OR: [{ id: projectIdOrSlug }, { slug: projectIdOrSlug }],
    },
    select: { id: true, slug: true, name: true, workflow: true, organisation: { select: { slug: true } } },
  });
  if (!project) throw new IssueApiError(404, "Project not found.");

  const currentWorkflow = await workflowFor(project.id);
  const newLimit = parsed.data.revisionLimit;

  if (currentWorkflow.revisionLimit !== newLimit) {
    const changes = {
      revisionLimit: {
        from: currentWorkflow.revisionLimit,
        to: newLimit,
      },
    };

    await prisma.$transaction(async (tx) => {
      await tx.projectWorkflow.upsert({
        where: { projectId: project.id },
        update: { revisionLimit: newLimit },
        create: { projectId: project.id, revisionLimit: newLimit },
      });
      await tx.projectAuditEvent.create({
        data: {
          organisationId,
          projectId: project.id,
          actorUserId,
          action: "marketing.settings.updated",
          changes: changes as Prisma.InputJsonValue,
        },
      });
    });

    invalidateWorkflow(project.id);
  }

  return {
    projectId: project.id,
    slug: project.slug,
    ref: refOf(project),
    name: project.name,
    revisionLimit: newLimit,
  };
}
