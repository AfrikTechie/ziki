import { revalidateTag, updateTag } from "next/cache";

/**
 * The cache tags behind lib/lookups.ts and how to expire them. They live
 * apart from the cached reads so a module that only expires a tag (every
 * notification write, through lib/notify.ts) doesn't load Prisma queries,
 * organisation lookups and the default-data repair code with it.
 */

export const TAGS = {
  issueTypes: "lookup:issue-types",
  unread: (userId: string) => `notifications:unread:${userId}`,
} as const;

/**
 * Expires a cache tag. In a server action this is `updateTag`, which also
 * makes the action's own re-render read fresh data; anywhere else (a route
 * handler, an `after()` callback) `updateTag` throws, so it falls back to
 * expiring the tag immediately for the next request.
 */
export function expireTag(tag: string): void {
  try {
    updateTag(tag);
  } catch {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch (error) {
      // Outside any request (a script, a test). Nothing to expire.
      console.warn("[lookups] could not expire", tag, error);
    }
  }
}

export function expireUnreadCounts(userIds: Iterable<string>): void {
  for (const id of new Set(userIds)) expireTag(TAGS.unread(id));
}
