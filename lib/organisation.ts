import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * The Zedu organisation and project that the agent platform migration (#423) puts
 * every existing user and issue into. Until issues are scoped to the
 * session's organisation (#425), new issues land here too.
 */
export const ZEDU_SLUG = "zedu";

export type OrganisationProject = { organisationId: string; projectId: string };

let cached: Promise<OrganisationProject> | null = null;

/** The Zedu organisation and project ids. Looked up once per process. */
export function defaultOrganisationProject(
  db: PrismaClient | Prisma.TransactionClient,
): Promise<OrganisationProject> {
  cached ??= db.project
    .findFirst({
      where: { slug: ZEDU_SLUG, organisation: { slug: ZEDU_SLUG } },
      select: { id: true, organisationId: true },
    })
    .then((project) => {
      if (!project) throw new Error("The Zedu organisation is missing. Run the database migrations.");
      return { organisationId: project.organisationId, projectId: project.id };
    })
    .catch((error: unknown) => {
      // Don't remember a failure; the next call tries again.
      cached = null;
      throw error;
    });
  return cached;
}
