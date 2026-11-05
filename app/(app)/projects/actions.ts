"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { fieldError, fromZodError } from "@/lib/form-errors";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { refererProjectRef } from "@/lib/referer-path";
import { ideasPath, orgPath, projectRef } from "@/lib/project-paths";
import { currentTenantIdFor, NO_TENANT_MESSAGE } from "@/lib/tenant-context";
import { isTenantAdmin } from "@/lib/agents/membership";
import { isSuperAdmin, type AppRole } from "@/lib/roles";
import { createMissionSchema, createTestMissions } from "@/lib/missions";
import {
  nextProjectSlug,
  projectLinksSchema,
  projectNameSchema,
  projectSettingsSchema,
  projectSlugBase,
  parseRewardConfigFromFormData,
} from "./validation";
import {
  getPlatformRewardConfig,
  projectDefaultsFromPlatform,
} from "@/lib/points/platform-rewards";
import { parseProjectRewardConfig } from "@/lib/points/project-rewards";

export type ProjectActionResult = {
  error?: string;
  field?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
};

/** Back to the org's Projects page the action came from (#project-urls), with a message. */
async function projectsMessage(key: "error" | "notice", message: string): Promise<string> {
  const slug = await refererProjectRef();
  return slug ? `${orgPath(slug, "projects")}?${key}=${encodeURIComponent(message)}` : "/home";
}

/** The current tenant, only when the signed-in person owns it or is super admin. */
async function ownerTenantFor(
  userId: string,
  userRole?: AppRole | null,
): Promise<{ tenantId: string } | { error: string }> {
  const tenantId = await currentTenantIdFor(userId);
  if (!tenantId) return { error: NO_TENANT_MESSAGE };

  if (isSuperAdmin(userRole)) {
    return { tenantId };
  }

  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { role: true },
  });
  if (membership?.role !== "owner") {
    return { error: "Only a tenant owner can manage its projects." };
  }
  return { tenantId };
}

function projectInTenant(tenantId: string, projectId: string) {
  if (!projectId) return null;
  return prisma.project.findFirst({
    where: { id: projectId, tenantId },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      _count: { select: { bugs: true } },
    },
  });
}

export async function updateProjectAction(
  _previous: ProjectActionResult | undefined,
  formData: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) return { error: NO_TENANT_MESSAGE };
  if (!(await isTenantAdmin(user, tenantId))) return { error: "Only workspace owners and admins can change project settings." };

  const parsed = projectSettingsSchema.safeParse({
    name: formData.get("name"),
    goal: formData.get("goal"),
    repoUrl: formData.get("repoUrl"),
    stagingUrl: formData.get("stagingUrl"),
    siteUrl: formData.get("siteUrl") ?? "",
  });
  if (!parsed.success) return fromZodError(parsed.error, "Check the project settings.");
  const slug = String(formData.get("slug") ?? "").trim();
  const project = await prisma.project.findFirst({
    where: { tenantId, slug },
    select: { id: true, name: true, goal: true, repoUrl: true, stagingUrl: true, siteUrl: true, rewardConfig: true },
  });
  if (!project) return { error: "Project not found." };

  const rawReward = parseRewardConfigFromFormData(formData);
  const platformBase = projectDefaultsFromPlatform(await getPlatformRewardConfig(prisma));
  const rewardConfig = rawReward ? parseProjectRewardConfig(rawReward, platformBase) : undefined;

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["name", "goal", "repoUrl", "stagingUrl", "siteUrl"] as const) {
    if (project[field] !== parsed.data[field]) {
      changes[field] = { from: project[field], to: parsed.data[field] };
    }
  }
  if (rewardConfig !== undefined && JSON.stringify(project.rewardConfig) !== JSON.stringify(rewardConfig)) {
    changes.rewardConfig = { from: project.rewardConfig, to: rewardConfig };
  }

  if (Object.keys(changes).length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id },
        data: {
          ...parsed.data,
          ...(rewardConfig !== undefined ? { rewardConfig } : {}),
        },
      });
      await tx.projectAuditEvent.create({
        data: {
          tenantId,
          projectId: project.id,
          actorUserId: user.id,
          action: "settings.updated",
          changes: changes as Prisma.InputJsonValue,
        },
      });
    });
  }
  revalidatePath(`/projects/${slug}/settings`);
  revalidatePath("/", "layout");
  return {};
}

/**
 * The panel above the list (#project-links): set the project's live site and
 * GitHub repository in one step. Same rules as the settings page: workspace
 * owners and admins only, validated the same way, recorded in the project's
 * audit log.
 */
export async function saveProjectLinksAction(
  _previous: ProjectActionResult | undefined,
  formData: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) return { error: NO_TENANT_MESSAGE };
  if (!(await isTenantAdmin(user, tenantId))) return { error: "Only workspace owners and admins can set these." };

  const parsed = projectLinksSchema.safeParse({ siteUrl: formData.get("siteUrl") ?? "", repoUrl: formData.get("repoUrl") ?? "" });
  if (!parsed.success) return fromZodError(parsed.error, "Check the addresses.");
  const slug = String(formData.get("slug") ?? "").trim();
  const project = await prisma.project.findFirst({ where: { tenantId, slug }, select: { id: true, siteUrl: true, repoUrl: true } });
  if (!project) return { error: "Project not found." };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["siteUrl", "repoUrl"] as const) {
    if (project[field] !== parsed.data[field]) changes[field] = { from: project[field], to: parsed.data[field] };
  }
  if (Object.keys(changes).length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: project.id }, data: parsed.data });
      await tx.projectAuditEvent.create({
        data: { tenantId, projectId: project.id, actorUserId: user.id, action: "settings.updated", changes: changes as Prisma.InputJsonValue },
      });
    });
  }
  revalidatePath("/", "layout");
  return { message: "Saved." };
}

/** Create a route/role/viewport mission set for a project (#619). */
export async function createTestMissionAction(
  _previous: ProjectActionResult | undefined,
  formData: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) return { error: NO_TENANT_MESSAGE };

  const projectId = String(formData.get("projectId") ?? "").trim();
  const project = projectId ? await prisma.project.findFirst({
    where: { id: projectId, tenantId },
    select: { id: true },
  }) : null;
  if (!project) return { error: "Project not found." };
  if (!(await isTenantAdmin(user, tenantId))) {
    return { error: "Only project admins can manage test missions." };
  }

  const parsed = createMissionSchema.safeParse({
    routePattern: formData.get("routePattern"),
    brief: formData.get("brief"),
    roles: formData.getAll("roles"),
    viewports: formData.getAll("viewports"),
  });
  if (!parsed.success) return fromZodError(parsed.error, "Check the mission details");

  const result = await createTestMissions(project.id, parsed.data);
  revalidatePath("/", "layout");
  return result.count > 0
    ? { message: `Added ${result.count} test mission${result.count === 1 ? "" : "s"}.` }
    : { message: "Those route, role, and viewport missions already exist." };
}

/**
 * Create a project in the current tenant and make it active (#426).
 *
 * The slug is derived from the name; a second "Zedu Web" becomes
 * "zedu-web-2" rather than failing the person's click.
 */
export async function createProjectAction(
  _previous: ProjectActionResult | undefined,
  formData: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) return { error: NO_TENANT_MESSAGE };

  const parsed = projectNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return fromZodError(parsed.error, "Invalid project name");

  const existing = await prisma.project.findMany({
    where: { tenantId },
    select: { slug: true },
  });
  const slug = nextProjectSlug(
    projectSlugBase(parsed.data.name),
    new Set(existing.map((project) => project.slug)),
  );

  const rawReward = parseRewardConfigFromFormData(formData);
  const platformBase = projectDefaultsFromPlatform(await getPlatformRewardConfig(prisma));
  const rewardConfig = rawReward ? parseProjectRewardConfig(rawReward, platformBase) : null;

  try {
    await prisma.project.create({
      data: {
        tenantId,
        name: parsed.data.name,
        slug,
        rewardConfig: rewardConfig ?? undefined,
        workflow: { create: {} },
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return fieldError("name", "A project with that name already exists.");
    }
    throw error;
  }

  revalidatePath("/", "layout");
  // A new project opens on its own page (#project-urls).
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  redirect(tenant ? ideasPath(projectRef(tenant.slug, slug)) : "/home");
}

/** Archive or restore a project the tenant owner owns. */
export async function setProjectArchivedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const owner = await ownerTenantFor(user.id, user.role);
  if ("error" in owner) redirect(await projectsMessage("error", owner.error));

  const project = await projectInTenant(owner.tenantId, String(formData.get("projectId") ?? ""));
  if (!project) redirect(await projectsMessage("error", "That project isn't in this workspace."));

  const archived = String(formData.get("archived") ?? "") === "true";
  if (Boolean(project.archivedAt) !== archived) {
    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: archived ? new Date() : null },
    });
  }

  revalidatePath("/", "layout");
  redirect(await projectsMessage("notice", archived ? "Project archived." : "Project restored."));
}

/** Delete a project after the owner types its name, and only when it has no issues. */
export async function deleteProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const owner = await ownerTenantFor(user.id, user.role);
  if ("error" in owner) redirect(await projectsMessage("error", owner.error));

  const project = await projectInTenant(owner.tenantId, String(formData.get("projectId") ?? ""));
  if (!project) redirect(await projectsMessage("error", "That project isn't in this workspace."));

  if (project._count.bugs > 0) {
    redirect(
      await projectsMessage("error", "This project still has issues. Archive it instead."),
    );
  }

  const typed = String(formData.get("confirmName") ?? "").trim();
  if (typed !== project.name) {
    redirect(await projectsMessage("error", "Type the project's name exactly to confirm."));
  }

  try {
    await prisma.project.delete({ where: { id: project.id } });
  } catch (error) {
    console.error("[projects] deleteProjectAction failed", error);
    redirect(await projectsMessage("error", "Couldn't delete this project. Archive it instead."));
  }

  revalidatePath("/", "layout");
  redirect(await projectsMessage("notice", "Project deleted."));
}
