"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth-helpers";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { prisma } from "@/lib/prisma";
import {
  canonicalGitHubRepoUrl,
  PROJECT_EXTRA_REPOSITORIES_MAX,
  projectRepositorySchema,
} from "@/app/(app)/projects/validation";

/**
 * More GitHub repositories for a project (#2). `Project.repoUrl` stays the main
 * one; these are the others (an API next to a web app, a mobile app, ...).
 */
export type ProjectRepositoryActionResult = { ok: true } | { ok: false; error: string };

async function projectSettingsAccess(slug: string) {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { ok: false as const, error: NO_ORGANISATION_MESSAGE };
  if (!(await isAdminOfOrganisation(user, organisationId))) {
    return { ok: false as const, error: "Only organisation owners and admins can change project repositories." };
  }
  const project = await prisma.project.findFirst({
    where: { organisationId, slug },
    select: { id: true, slug: true, repoUrl: true },
  });
  if (!project) return { ok: false as const, error: "Project not found." };
  return { ok: true as const, user, organisationId, project };
}

function revalidateProject(slug: string) {
  revalidatePath(`/projects/${encodeURIComponent(slug)}/settings`);
  revalidatePath("/", "layout");
}

function isMainRepository(mainUrl: string | null, url: string): boolean {
  if (!mainUrl) return false;
  try {
    return canonicalGitHubRepoUrl(mainUrl) === url;
  } catch {
    return false;
  }
}

export async function addProjectRepositoryAction(
  _previous: ProjectRepositoryActionResult | undefined,
  formData: FormData,
): Promise<ProjectRepositoryActionResult> {
  const access = await projectSettingsAccess(String(formData.get("slug") ?? "").trim());
  if (!access.ok) return access;
  const parsed = projectRepositorySchema.safeParse({
    url: formData.get("url") ?? "",
    label: formData.get("label") ?? "",
    branch: formData.get("branch") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the repository details." };
  if (isMainRepository(access.project.repoUrl, parsed.data.url)) {
    return { ok: false, error: "That is already the project's main repository." };
  }
  const count = await prisma.projectRepository.count({ where: { projectId: access.project.id } });
  if (count >= PROJECT_EXTRA_REPOSITORIES_MAX) {
    return { ok: false, error: `A project can list at most ${PROJECT_EXTRA_REPOSITORIES_MAX} more repositories.` };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const repository = await tx.projectRepository.create({
        data: { projectId: access.project.id, ...parsed.data },
        select: { id: true },
      });
      await tx.projectAuditEvent.create({
        data: {
          organisationId: access.organisationId,
          projectId: access.project.id,
          actorUserId: access.user.id,
          action: "repository.added",
          changes: { repository: { from: null, to: { id: repository.id, ...parsed.data } } },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "That repository is already listed." };
    }
    throw error;
  }
  revalidateProject(access.project.slug);
  return { ok: true };
}

export async function removeProjectRepositoryAction(
  slug: string,
  repositoryId: string,
): Promise<ProjectRepositoryActionResult> {
  const access = await projectSettingsAccess(slug.trim());
  if (!access.ok) return access;
  const repository = await prisma.projectRepository.findFirst({
    where: { id: repositoryId, projectId: access.project.id },
    select: { id: true, url: true, label: true, branch: true },
  });
  if (!repository) return { ok: false, error: "That repository is no longer listed." };

  // An open issue whose fix is in this repository could no longer be delivered,
  // accepted or resolved once the repository is gone, so keep it until that
  // work is done.
  const linked = await prisma.bug.count({
    where: {
      projectId: access.project.id,
      isDeleted: false,
      status: { notIn: ["resolved", "closed"] },
      pullRequestUrl: { startsWith: `${repository.url}/pull/`, mode: "insensitive" },
    },
  });
  if (linked > 0) {
    return { ok: false, error: `${linked} open ${linked === 1 ? "issue links a pull request" : "issues link pull requests"} in this repository. Remove it once they are done.` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectRepository.delete({ where: { id: repository.id } });
    await tx.projectAuditEvent.create({
      data: {
        organisationId: access.organisationId,
        projectId: access.project.id,
        actorUserId: access.user.id,
        action: "repository.removed",
        changes: { repository: { from: repository, to: null } },
      },
    });
  });
  revalidateProject(access.project.slug);
  return { ok: true };
}
