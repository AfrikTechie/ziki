"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { canManageProject } from "@/lib/project-permissions";
import { orgPath, projectPath, projectRef } from "@/lib/project-paths";

export type JoinRequestActionResult = {
  ok?: boolean;
  error?: string;
};

/**
 * Apply or re-apply to join an open project as an external contributor.
 */
export async function requestToJoinProjectAction(formData: FormData): Promise<JoinRequestActionResult> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim().slice(0, 1000);

  if (!projectId) return { error: "Project ID is required." };

  const project = await prisma.project.findFirst({
    where: { id: projectId, archivedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      organisationId: true,
      isOpenForContributors: true,
      visibility: true,
      organisation: { select: { slug: true } },
    },
  });

  if (!project) return { error: "Project not found." };
  if (!project.isOpenForContributors || project.visibility !== "public") {
    return { error: "This project is not currently accepting contributor applications." };
  }

  // Check if already an org member or project member
  const [isOrgMember, isProjectMember] = await Promise.all([
    prisma.membership.findUnique({ where: { organisationId_userId: { organisationId: project.organisationId, userId: user.id } } }),
    prisma.projectMembership.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } }),
  ]);

  if (isOrgMember || isProjectMember) {
    return { error: "You are already a member of this project." };
  }

  // Check existing request for rate limiting and duplicate prevention
  const existingRequest = await prisma.projectJoinRequest.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
  });
  if (existingRequest?.status === "pending") {
    return { error: "You already have a pending request to join this project." };
  }
  if (
    existingRequest?.updatedAt &&
    Date.now() - existingRequest.updatedAt.getTime() < 10 * 60 * 1000
  ) {
    return { error: "Please wait a few minutes before submitting another request." };
  }

  // Upsert join request (re-apply if previously rejected)
  await prisma.projectJoinRequest.upsert({
    where: { projectId_userId: { projectId, userId: user.id } },
    create: {
      projectId,
      userId: user.id,
      message: message || null,
      status: "pending",
    },
    update: {
      message: message || null,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
    },
  });

  // Notify organisation managers
  const managers = await prisma.membership.findMany({
    where: { organisationId: project.organisationId, role: { in: ["owner", "admin"] } },
    select: { userId: true },
  });

  const pRef = projectRef(project.organisation.slug, project.slug);
  if (managers.length > 0) {
    await prisma.notification.createMany({
      data: managers.map((m) => ({
        userId: m.userId,
        organisationId: project.organisationId,
        kind: "join_request",
        title: `${user.name || user.email} requested to join ${project.name}`,
        url: orgPath(pRef, "invites"),
      })),
      skipDuplicates: true,
    }).catch(() => {});
  }

  revalidatePath("/discover");
  revalidatePath(orgPath(pRef, "invites"));
  return { ok: true };
}

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
