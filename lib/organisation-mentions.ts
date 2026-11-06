import type { Prisma } from "@prisma/client";
import { extractMentionedUserIds, normalizeMentions } from "@/lib/mentions";

/**
 * #502: an @mention only means something inside the issue's own organisation.
 * Resolving tags against every account on the site let anyone notify (and
 * email the issue title to) people in other organisations.
 */

/** Users who belong to `organisationId`: the only people a mention may resolve to. */
export function organisationMemberWhere(organisationId: string): Prisma.UserWhereInput {
  return { memberships: { some: { organisationId } } };
}

type UserReader = Pick<Prisma.TransactionClient, "user">;

/**
 * Canonicalise `@[Name](userId)` tags against the organisation's members. Members
 * get their current name; anyone else (unknown, or in another organisation)
 * degrades to plain `@Name`, so they are never notified.
 */
export async function resolveOrganisationMentions(
  db: UserReader,
  organisationId: string,
  text: string,
): Promise<string> {
  const ids = extractMentionedUserIds(text);
  if (ids.length === 0) return text;
  const members = await db.user.findMany({
    where: { id: { in: ids }, ...organisationMemberWhere(organisationId) },
    select: { id: true, name: true },
  });
  return normalizeMentions(text, new Map(members.map((user) => [user.id, user.name])));
}
