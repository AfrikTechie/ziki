import type { Prisma, PrismaClient } from "@prisma/client";
import { ZEDU_SLUG } from "@/lib/organisation";

/**
 * An organisation's projects, and its default one (#426): the Zedu project, else
 * the oldest. Pages that show a project take it from their URL's slug
 * (lib/project-route.ts, #project-urls); nothing remembers a project in a
 * cookie. The default is for organisation-level work with no project in its
 * address yet.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type ProjectChoice = {
  id: string;
  name: string;
  slug: string;
};

export type ProjectContext = {
  projects: ProjectChoice[];
  activeProjectId: string | null;
};

/** A project in `projects`, preferring `requestedId`, then Zedu, then oldest. */
export function pickProjectId(
  projects: ReadonlyArray<Pick<ProjectChoice, "id" | "slug">>,
  requestedId?: string | null,
): string | null {
  if (requestedId) {
    const requested = projects.find((project) => project.id === requestedId);
    if (requested) return requested.id;
  }
  return (projects.find((project) => project.slug === ZEDU_SLUG) ?? projects[0])?.id ?? null;
}

export async function projectsForOrganisation(
  db: Db,
  organisationId: string,
): Promise<ProjectChoice[]> {
  try {
    return await db.project.findMany({
      where: { organisationId, archivedAt: null },
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    console.error("[project-context] projectsForOrganisation failed", error);
    return [];
  }
}

/** The organisation's projects, and its default one. */
export async function projectContextFor(
  db: Db,
  organisationId: string | null,
): Promise<ProjectContext> {
  if (!organisationId) return { projects: [], activeProjectId: null };

  try {
    const projects = await projectsForOrganisation(db, organisationId);
    return { projects, activeProjectId: pickProjectId(projects) };
  } catch (error) {
    console.error("[project-context] projectContextFor failed", error);
    return { projects: [], activeProjectId: null };
  }
}

/** The organisation's default project: Zedu, else the oldest. */
export async function activeProjectIdFor(
  db: Db,
  organisationId: string | null,
): Promise<string | null> {
  return (await projectContextFor(db, organisationId)).activeProjectId;
}
