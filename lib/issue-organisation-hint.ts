import type { Prisma, PrismaClient, Substatus } from "@prisma/client";

/**
 * Cross-organisation issue links (#519).
 *
 * Issue pages are scoped to the active organisation. When a member follows a link
 * to an issue in another organisation they belong to, that scoping turns into a
 * dead end. This resolver names the owning organisation — but only for members of
 * it, so non-members keep the plain 404 and nothing is revealed.
 */

export type IssueOrganisationHint = { id: string; name: string; slug: string; issue: { number: number; title: string; substatus: Substatus; projectName: string } };

type Db = PrismaClient | Prisma.TransactionClient;

export async function issueOrganisationHintFor(
  db: Db,
  viewer: { userId: string; activeOrganisationId: string | null; issueId: string },
): Promise<IssueOrganisationHint | null> {
  try {
    const bug = await db.bug.findUnique({
      where: { id: viewer.issueId, isDeleted: false, project: { archivedAt: null } },
      select: { organisationId: true, number: true, title: true, substatus: true, project: { select: { name: true } } },
    });
    if (!bug || bug.organisationId === viewer.activeOrganisationId) return null;

    const membership = await db.membership.findFirst({
      where: { userId: viewer.userId, organisationId: bug.organisationId, organisation: { archivedAt: null } },
      select: { organisation: { select: { id: true, name: true, slug: true } } },
    });
    return membership ? { ...membership.organisation, issue: { number: bug.number, title: bug.title, substatus: bug.substatus, projectName: bug.project.name } } : null;
  } catch (error) {
    // A schema-repair deployment may lack the relation; the page then keeps
    // its plain 404 instead of failing.
    console.error("[issues] organisation hint lookup failed", error);
    return null;
  }
}
