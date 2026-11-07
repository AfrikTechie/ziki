"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { canManageProject } from "@/lib/project-permissions";
import { marketingPath, orgPath, projectPath, projectRef } from "@/lib/project-paths";
import { projectHomePath } from "@/lib/marketing/project-home";

export type JoinRequestActionResult = {
  ok?: boolean;
  error?: string;
};

/**
 * Accept a pending join request. Org admins only.
 */
export async function acceptJoinRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!requestId) return;

  const joinRequest = await prisma.projectJoinRequest.findUnique({
    where: { id: requestId },
    include: {
      project: {
        select: {
          id: true,
          slug: true,
          name: true,
          organisationId: true,
          organisation: { select: { slug: true } },
        },
      },
    },
  });

  if (!joinRequest || joinRequest.status !== "pending") {
    return;
  }

  if (!(await canManageProject(user, joinRequest.project.organisationId))) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update request status
    await tx.projectJoinRequest.update({
      where: { id: requestId },
      data: {
        status: "accepted",
        reviewedBy: user.id,
        reviewedAt: new Date(),
      },
    });

    // 2. Add ProjectMembership
    await tx.projectMembership.upsert({
      where: { projectId_userId: { projectId: joinRequest.projectId, userId: joinRequest.userId } },
      create: { projectId: joinRequest.projectId, userId: joinRequest.userId },
      update: {},
    });

    const pRef = projectRef(joinRequest.project.organisation.slug, joinRequest.project.slug);
    // 3. Notify the applicant
    await tx.notification.create({
      data: {
        userId: joinRequest.userId,
        organisationId: null,
        kind: "join_request_accepted",
        title: `Your request to join ${joinRequest.project.name} was accepted!`,
        url: projectPath(pRef),
      },
    });
  });

  const pRef = projectRef(joinRequest.project.organisation.slug, joinRequest.project.slug);
  revalidatePath(orgPath(pRef, "invites"));
  revalidatePath(orgPath(pRef, "members"));
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/discover");
}

/**
 * Reject a pending join request. Org admins only.
 */
export async function rejectJoinRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!requestId) return;

  const joinRequest = await prisma.projectJoinRequest.findUnique({
    where: { id: requestId },
    include: {
      project: {
        select: {
          id: true,
          slug: true,
          name: true,
          organisationId: true,
          organisation: { select: { slug: true } },
        },
      },
    },
  });

  if (!joinRequest || joinRequest.status !== "pending") {
    return;
  }

  if (!(await canManageProject(user, joinRequest.project.organisationId))) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectJoinRequest.update({
      where: { id: requestId },
      data: {
        status: "rejected",
        reviewedBy: user.id,
        reviewedAt: new Date(),
      },
    });

    await tx.notification.create({
      data: {
        userId: joinRequest.userId,
        organisationId: null,
        kind: "join_request_rejected",
        title: `Your request to join ${joinRequest.project.name} was not accepted`,
        url: "/discover",
      },
    });
  });

  const pRef = projectRef(joinRequest.project.organisation.slug, joinRequest.project.slug);
  revalidatePath(orgPath(pRef, "invites"));
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/discover");
}

/**
 * Remove an external contributor from a project. Org admins only.
 */
export async function removeProjectMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const targetUserId = String(formData.get("userId") ?? "").trim();

  if (!projectId || !targetUserId) return;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      organisationId: true,
      slug: true,
      organisation: { select: { slug: true } },
    },
  });

  if (!project) return;

  if (!(await canManageProject(user, project.organisationId))) {
    return;
  }

  await prisma.projectMembership.deleteMany({
    where: { projectId, userId: targetUserId },
  });

  const pRef = projectRef(project.organisation.slug, project.slug);
  revalidatePath(orgPath(pRef, "members"));
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/discover");
}

export type JoinOpenProjectResult = { ok: true; href: string } | { ok: false; error: string };

/**
 * Joins a project that is open for contributors straight away (#earnings): no request to wait on and nobody to
 * accept it, because opening the project to contributors already said yes. Any earlier request is marked accepted.
 * It also makes you a member of the project's organisation, so you can connect an agent there.
 * Returns where to go next: the project's Marketing tab when it has marketing tasks waiting for bids or is all
 * marketing (#marketing-home), else its Ideas.
 */
export async function joinOpenProjectAction(projectId: string): Promise<JoinOpenProjectResult> {
  const user = await requireUser();
  const project = await prisma.project.findFirst({
    where: { id: projectId, archivedAt: null },
    select: { id: true, slug: true, isOpenForContributors: true, visibility: true, organisationId: true, organisation: { select: { slug: true } } },
  });
  if (!project) return { ok: false, error: "Project not found." };
  if (!project.isOpenForContributors || project.visibility !== "public") {
    return { ok: false, error: "This project isn't open to join right now." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMembership.upsert({
      where: { projectId_userId: { projectId: project.id, userId: user.id } },
      create: { projectId: project.id, userId: user.id },
      update: {},
    });
    // Joining also makes you a member of the project's organisation (#earnings, Chloe's call), so connecting an
    // agent works as it does for anyone else there: the Create an agent card, Connect your agent, and its key.
    // Someone already in it keeps their role.
    await tx.membership.upsert({
      where: { organisationId_userId: { organisationId: project.organisationId, userId: user.id } },
      create: { organisationId: project.organisationId, userId: user.id, role: "member" },
      update: {},
    });
    await tx.projectJoinRequest.updateMany({
      where: { projectId: project.id, userId: user.id, status: "pending" },
      data: { status: "accepted", reviewedAt: new Date() },
    });
  });

  const pRef = projectRef(project.organisation.slug, project.slug);
  const marketingTasks = await prisma.bug.count({
    where: { projectId: project.id, track: "marketing", status: "open", isDeleted: false },
  });
  revalidatePath("/discover");
  revalidatePath(orgPath(pRef, "members"));
  const href = marketingTasks > 0 ? marketingPath(pRef) : await projectHomePath(prisma, project.id, pRef);
  return { ok: true, href };
}
