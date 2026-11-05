"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth-helpers";
import { isTenantAdmin } from "@/lib/agents/membership";
import { currentTenantIdFor, NO_TENANT_MESSAGE } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { nextProjectSlug, projectAreaSchema, urlSlugBase } from "@/app/(app)/projects/validation";

export type ProjectAreaActionResult = { ok: true } | { ok: false; error: string };

async function projectSettingsAccess(slug: string) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) return { ok: false as const, error: NO_TENANT_MESSAGE };
  if (!(await isTenantAdmin(user, tenantId))) {
    return { ok: false as const, error: "Only workspace owners and admins can change project areas." };
  }
  const project = await prisma.project.findFirst({
    where: { tenantId, slug },
    select: { id: true, slug: true },
  });
  if (!project) return { ok: false as const, error: "Project not found." };
  return { ok: true as const, user, tenantId, project };
}

function revalidateProject(slug: string) {
  revalidatePath(`/projects/${encodeURIComponent(slug)}/settings`);
  revalidatePath("/[org]/[project]", "layout");
}

/** How many times a create re-reads the slugs after losing a race to the same slug. */
const CREATE_ATTEMPTS = 3;

/** A unique-index violation on the area's slug, as opposed to any other database error. */
function isSlugCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes("slug");
  return typeof target === "string" ? target.includes("slug") : true;
}

function areaInput(formData: FormData) {
  return projectAreaSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    paths: formData.get("paths") ?? "",
  });
}

export async function createProjectAreaAction(
  _previous: ProjectAreaActionResult | undefined,
  formData: FormData,
): Promise<ProjectAreaActionResult> {
  const slug = String(formData.get("slug") ?? "").trim();
  const access = await projectSettingsAccess(slug);
  if (!access.ok) return access;
  const parsed = areaInput(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the area details." };

  // The slug is picked from the slugs read a moment ago, so two admins adding
  // the same name together both pick the same one and the second insert hits
  // the (projectId, slug) unique index. Read again and take the next free slug
  // instead of failing (#968).
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const existing = await prisma.projectArea.findMany({
      where: { projectId: access.project.id },
      select: { slug: true },
    });
    const areaSlug = nextProjectSlug(urlSlugBase(parsed.data.name), new Set(existing.map((area) => area.slug)));
    try {
      await prisma.$transaction(async (tx) => {
        const area = await tx.projectArea.create({
          data: { projectId: access.project.id, ...parsed.data, slug: areaSlug },
          select: { id: true },
        });
        await tx.projectAuditEvent.create({
          data: {
            tenantId: access.tenantId,
            projectId: access.project.id,
            actorUserId: access.user.id,
            action: "area.created",
            changes: { area: { from: null, to: { id: area.id, ...parsed.data, slug: areaSlug } } },
          },
        });
      });
    } catch (error) {
      if (isSlugCollision(error)) continue;
      throw error;
    }
    revalidateProject(access.project.slug);
    return { ok: true };
  }
  return { ok: false, error: "Another area was added at the same time. Please try again." };
}

export async function updateProjectAreaAction(
  _previous: ProjectAreaActionResult | undefined,
  formData: FormData,
): Promise<ProjectAreaActionResult> {
  const slug = String(formData.get("slug") ?? "").trim();
  const areaId = String(formData.get("areaId") ?? "").trim();
  if (!areaId) return { ok: false, error: "Choose an area to update." };
  const access = await projectSettingsAccess(slug);
  if (!access.ok) return access;
  const parsed = areaInput(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the area details." };
  const area = await prisma.projectArea.findFirst({
    where: { id: areaId, projectId: access.project.id },
    select: { id: true, name: true, description: true, paths: true, slug: true },
  });
  if (!area) return { ok: false, error: "Area not found in this project." };

  const changes = Object.fromEntries(
    (Object.keys(parsed.data) as (keyof typeof parsed.data)[])
      .filter((field) => JSON.stringify(area[field]) !== JSON.stringify(parsed.data[field]))
      .map((field) => [field, { from: area[field], to: parsed.data[field] }]),
  );
  if (Object.keys(changes).length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.projectArea.update({ where: { id: area.id }, data: parsed.data });
      await tx.projectAuditEvent.create({
        data: {
          tenantId: access.tenantId,
          projectId: access.project.id,
          actorUserId: access.user.id,
          action: "area.updated",
          changes: { areaId: area.id, ...changes },
        },
      });
    });
  }
  revalidateProject(access.project.slug);
  return { ok: true };
}

export async function deleteProjectAreaAction(
  _previous: ProjectAreaActionResult | undefined,
  formData: FormData,
): Promise<ProjectAreaActionResult> {
  const slug = String(formData.get("slug") ?? "").trim();
  const areaId = String(formData.get("areaId") ?? "").trim();
  if (!areaId) return { ok: false, error: "Choose an area to delete." };
  const access = await projectSettingsAccess(slug);
  if (!access.ok) return access;
  const area = await prisma.projectArea.findFirst({
    where: { id: areaId, projectId: access.project.id },
    select: { id: true, name: true, slug: true },
  });
  if (!area) return { ok: false, error: "Area not found in this project." };

  await prisma.$transaction(async (tx) => {
    await tx.projectArea.delete({ where: { id: area.id } });
    await tx.projectAuditEvent.create({
      data: {
        tenantId: access.tenantId,
        projectId: access.project.id,
        actorUserId: access.user.id,
        action: "area.deleted",
        changes: { area: { from: area, to: null } },
      },
    });
  });
  revalidateProject(access.project.slug);
  return { ok: true };
}