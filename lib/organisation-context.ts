import { cache } from "react";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeProjectIdFor } from "@/lib/project-context";
import { ZEDU_SLUG } from "@/lib/organisation";
import { readActiveOrganisationCookie } from "@/lib/organisations";

/**
 * The organisation every read and write of issues, comments and notifications is
 * scoped to (#425).
 *
 * The organisation comes from the person's membership, never from merely having a
 * session. Existing users are members of Zedu (#423), so they land there. A
 * new account has no membership, gets `null`, and sees no issues at all until
 * they create or join a organisation (#444).
 */

type Db = PrismaClient | Prisma.TransactionClient;

type MembershipChoice = { organisationId: string; organisation: { slug: string } };

/**
 * Picks the organisation to show from someone's memberships: the one they picked
 * on this device (#444) if they still belong to it, else Zedu if they belong
 * to it, else their oldest membership. A pick they aren't a member of is
 * ignored, so the "no membership, no organisation" rule stays.
 */
export function pickOrganisationId(
  memberships: ReadonlyArray<MembershipChoice>,
  pickedOrganisationId?: string | null,
): string | null {
  const picked = pickedOrganisationId ? memberships.find((m) => m.organisationId === pickedOrganisationId) : undefined;
  const zedu = memberships.find((m) => m.organisation.slug === ZEDU_SLUG);
  return (picked ?? zedu ?? memberships[0])?.organisationId ?? null;
}

export async function organisationIdForUser(
  db: Db,
  userId: string | null | undefined,
  pickedOrganisationId?: string | null,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const memberships = await db.membership.findMany({
      where: { userId, organisation: { archivedAt: null } },
      select: { organisationId: true, organisation: { select: { slug: true } } },
      orderBy: { createdAt: "asc" },
    });
    return pickOrganisationId(memberships, pickedOrganisationId);
  } catch (error) {
    console.error("[organisation-context] organisationIdForUser failed", error);
    return null;
  }
}

/** `organisationIdForUser` with this device's pick (#444), looked up once per request. */
export const currentOrganisationIdFor = cache(async (userId: string | null | undefined) => {
  try {
    const picked = userId ? await readActiveOrganisationCookie() : null;
    return await organisationIdForUser(prisma, userId, picked);
  } catch (error) {
    console.error("[organisation-context] currentOrganisationIdFor failed", error);
    return null;
  }
});

/**
 * The project new issues go into: the active project (#426), else the organisation's
 * Zedu project, else its oldest.
 */
export async function defaultProjectIdFor(db: Db, organisationId: string): Promise<string | null> {
  return activeProjectIdFor(db, organisationId);
}

/**
 * The organisation part of a `where`. Only `organisationId`, so it can be spread into a
 * `findUnique({ where: { id } })` as well as a list filter.
 */
export type OrganisationScope = { organisationId: string | { in: string[] } };

/** Matches nothing: what someone with no organisation is allowed to see. */
const NO_ORGANISATION: OrganisationScope = { organisationId: { in: [] } };

/** Issues in `organisationId`. With no organisation, no issues. */
export function bugInOrganisation(organisationId: string | null): OrganisationScope {
  return organisationId ? { organisationId } : NO_ORGANISATION;
}

/**
 * True only when the database says the `organisationId` or `projectId` column is
 * absent. A Prisma error that merely prints those fields in the query, or a
 * different missing column, is not this — those must not drop the organisation
 * filter (#439).
 */
export function isMissingOrganisationColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  const metaColumn =
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2022" &&
    "meta" in error &&
    typeof (error as { meta?: { column?: unknown } }).meta?.column === "string"
      ? (error as { meta: { column: string } }).meta.column
      : "";
  return /column [`'"]?(?:[\w."]+\.)*(?:organisationId|projectId)[`'"]?(?: of relation [`'"]?[\w.]+[`'"]?)? does not exist/i.test(
    `${message}\n${metaColumn}`,
  ) || /^(?:[\w."]+\.)*(?:organisationId|projectId)$/i.test(metaColumn);
}

/** Comments on issues in `organisationId`. */
export function commentInOrganisation(organisationId: string | null): { bug: OrganisationScope } {
  return { bug: bugInOrganisation(organisationId) };
}

/**
 * Notifications in `organisationId`. Personal notifications without an organisation stay
 * visible in each organisation; the feed can bypass this scope for all organisations.
 * A organisation invite is personal too: the recipient is not in that organisation yet,
 * so hiding it behind the destination organisation means they never see it.
 */
export function notificationInOrganisation(
  organisationId: string | null,
  allOrganisations = false,
): Prisma.NotificationWhereInput {
  if (allOrganisations) return {};
  const invite = { kind: "organisation_invite" };
  if (!organisationId) return { OR: [{ organisationId: null }, invite] };
  return { OR: [{ organisationId: null }, { organisationId }, invite] };
}

/** Shown when someone without a organisation tries to file an issue. */
export const NO_ORGANISATION_MESSAGE =
  "You're not a member of an organisation yet, so you can't file issues here.";
