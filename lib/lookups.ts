import { unstable_cache } from "next/cache";
import { TAGS } from "@/lib/cache-tags";
import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor, notificationInTenant } from "@/lib/tenant-context";
import { ensureDefaultIssueTypes } from "@/lib/issue-types";

/**
 * Cached reads for data that changes only through an admin action (#297, #317).
 *
 * Issue types were queried on every render of the issues list, the issue
 * page and the report form. They are cached here under a tag and expired by
 * the admin actions that change them, so an edit shows up on the very next
 * request.
 *
 * What's cached is data that's identical for everyone. The one per-user
 * entry is the unread notification count, keyed by user id and expired by
 * every write that changes it.
 *
 * `revalidate` is a backstop, not the mechanism: it bounds how stale an
 * entry can get if something writes these tables outside the actions here
 * (a seed, a manual SQL fix), and on a self-hosted deployment with several
 * instances, where each instance keeps its own cache.
 */

export { TAGS, expireTag, expireUnreadCounts } from "@/lib/cache-tags";

const LOOKUP_TTL_SECONDS = 300;
const UNREAD_TTL_SECONDS = 60;

export type IssueTypeLookup = {
  id: string;
  name: string;
  description: string | null;
  template: string | null;
  isActive: boolean;
};

/**
 * True when Postgres is behind the migration that added this column.
 * A printed query that merely mentions the name does not count: Prisma
 * includes the SQL in unrelated errors.
 */
function missingColumn(error: unknown, column: string): boolean {
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
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?:^|[\\w."]*\\.)?${name}$`, "i").test(metaColumn)) return true;
  return new RegExp(
    `column [\`'\"]?(?:[\\w."]+\\.)*${name}[\`'\"]?(?: of relation [\`'\"]?[\\w.]+[\`'\"]?)? does not exist`,
    "i",
  ).test(message);
}

async function readIssueTypes(tenantId: string): Promise<IssueTypeLookup[]> {
  try {
    return await prisma.issueType.findMany({
      where: { tenantId, ...PRODUCT_TRACK },
      select: { id: true, name: true, description: true, template: true, isActive: true },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    // #307 added IssueType.template. A database that has not migrated yet
    // must still list types, or the report form is the only page that dies.
    if (!missingColumn(error, "template")) throw error;
    console.error("[lookups] IssueType.template is missing; reading types without it", error);
    const rows = await prisma.issueType.findMany({
      where: { tenantId, ...PRODUCT_TRACK },
      select: { id: true, name: true, description: true, isActive: true },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => ({ ...row, template: null }));
  }
}

const cachedIssueTypes = unstable_cache(readIssueTypes, ["lookup", "issue-types", "v2"], {
  tags: [TAGS.issueTypes],
  revalidate: LOOKUP_TTL_SECONDS,
});

/** Every issue type in this organization, active or not, by name. */
export async function getIssueTypes(tenantId?: string | null): Promise<IssueTypeLookup[]> {
  if (!tenantId) return [];
  // The tenant id is part of the cache key, so organizations don't share types.
  const types = await cachedIssueTypes(tenantId);
  if (types.length > 0) return types;
  await ensureDefaultIssueTypes(tenantId);
  return readIssueTypes(tenantId);
}

/** The issue types a new report can use in this organization. */
export async function getActiveIssueTypesCached(tenantId?: string | null): Promise<IssueTypeLookup[]> {
  return (await getIssueTypes(tenantId)).filter((t) => t.isActive);
}

/**
 * The header badge's unread count (#317). It was a query on every page
 * render; now it's one per user per change.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  // #444: the tenant picked on this device comes from a cookie, which a cached
  // function can't read. Resolve it here and key the entry by it.
  const tenantId = await currentTenantIdFor(userId);
  return unstable_cache(
    async () =>
      prisma.notification.count({
        // #425: the badge counts what the notifications page lists.
        where: { userId, readAt: null, ...notificationInTenant(tenantId) },
      }),
    ["notifications", "unread", userId, tenantId ?? "none"],
    { tags: [TAGS.unread(userId)], revalidate: UNREAD_TTL_SECONDS },
  )();
}
