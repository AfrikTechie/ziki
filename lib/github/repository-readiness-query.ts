import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { prisma } from "@/lib/prisma";
import { inspectDeliveryReadiness, inspectProjectReadiness } from "@/lib/github/repository-readiness";
import type { DeliveryReadinessResult, ReadinessResult } from "@/lib/github/repository-readiness-types";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

// Only the data needed for checks. Never select keys, sealed credentials, or
// delivery descriptions. The UI explicitly labels linked PRs as a recent sample.
const select = {
  id: true, name: true, slug: true, repoUrl: true, githubInstallationId: true,
  repositories: {
    select: { url: true, label: true, branch: true, githubInstallationId: true },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
  bugs: {
    where: { isDeleted: false, pullRequestUrl: { not: null } },
    select: { number: true, pullRequestUrl: true },
    orderBy: [{ updatedAt: "desc" as const }, { id: "desc" as const }],
    take: 20,
  },
} satisfies Prisma.ProjectSelect;

async function adminOrganisation(): Promise<string> {
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) redirect("/organisations");
  // Same organisation-owner/admin rule as project settings. A site-wide
  // admin who is merely a member does not gain access through this page.
  if (!(await isAdminOfOrganisation(user, organisationId))) notFound();
  return organisationId;
}

export async function loadRepositoryReadiness(): Promise<ReadinessResult> {
  const organisationId = await adminOrganisation();
  try {
    const projects = await prisma.project.findMany({
      where: { organisationId, archivedAt: null }, select,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const results = [];
    // At most three projects talk to GitHub concurrently. Each repository
    // check has the existing client's timeout and failures stay on its row.
    for (let index = 0; index < projects.length; index += 3) {
      results.push(...await Promise.all(projects.slice(index, index + 3).map(inspectProjectReadiness)));
    }
    return { ok: true, report: { organisationId, checkedAt: new Date().toISOString(), projects: results } };
  } catch {
    return { ok: false, error: "Could not load repository readiness. Recheck to try again." };
  }
}

const deliveryInput = z.object({ projectId: z.string().trim().min(1).max(128), pullRequestUrl: z.string().trim().min(1).max(1000) });

export async function checkProjectDelivery(input: unknown): Promise<DeliveryReadinessResult> {
  const organisationId = await adminOrganisation();
  const parsed = deliveryInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a project and enter a GitHub pull request URL." };
  try {
    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, organisationId, archivedAt: null }, select,
    });
    if (!project) return { ok: false, error: "Project not found in your current organisation." };
    return { ok: true, delivery: await inspectDeliveryReadiness(project, parsed.data.pullRequestUrl) };
  } catch {
    return { ok: false, error: "Could not check this delivery. Try again." };
  }
}
