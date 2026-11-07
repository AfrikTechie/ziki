import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { PublicProjectRef } from "@/lib/public-project-paths";

export function publicTrackingTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A non-login identity keeps required reporter relations intact without impersonating a person. */
export function publicReporterEmail(projectId: string): string {
  const projectHash = createHash("sha256").update(projectId).digest("hex").slice(0, 32);
  return `public-intake-${projectHash}@system.ziki.invalid`;
}

export async function findPublicProject(
  ref: PublicProjectRef,
  options: { requireGuestIntake?: boolean } = {},
) {
  return prisma.project.findFirst({
    where: {
      slug: ref.projectSlug,
      archivedAt: null,
      visibility: "public",
      ...(options.requireGuestIntake ? { acceptsGuestIdeas: true } : {}),
      organisation: { slug: ref.orgSlug, archivedAt: null },
    },
    select: {
      id: true,
      organisationId: true,
      slug: true,
      name: true,
      goal: true,
      repoUrl: true,
      siteUrl: true,
      isOpenForContributors: true,
      acceptsGuestIdeas: true,
      contributorGuidelines: true,
      organisation: { select: { name: true, slug: true } },
    },
  });
}
