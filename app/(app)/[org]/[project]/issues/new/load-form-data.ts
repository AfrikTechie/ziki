import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { currentTenantAccess } from "@/lib/tenant-access";
import { getActiveIssueTypesCached } from "@/lib/lookups";
import { tenantMemberWhere } from "@/lib/tenant-mentions";
import { requireProject } from "@/lib/project-route";

/**
 * Everything the report form needs, shared by the full page and the quick
 * report modal so both always load the same people and types.
 */
type MentionUser = { id: string; name: string; role: Role; image: string | null };

/** The issues list already survives a lookup failure. This form did not, so one bad read showed "This page didn't load". */
async function loadOrEmpty<T>(label: string, load: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error(`[issues/new] ${label} lookup failed`, error);
    return empty;
  }
}

async function loadMentionUsers(tenantId: string | null): Promise<MentionUser[]> {
  // #502: only members of the tenant the issue goes into can be mentioned.
  if (!tenantId) return [];
  const where = tenantMemberWhere(tenantId);
  try {
    return await prisma.user.findMany({
      where,
      select: { id: true, name: true, role: true, image: true },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    console.error("[issues/new] user lookup failed, retrying without image", error);
    try {
      const rows = await prisma.user.findMany({
        where,
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      });
      return rows.map((row) => ({ ...row, image: null }));
    } catch (fallbackError) {
      console.error("[issues/new] user lookup failed", fallbackError);
      return [];
    }
  }
}

async function loadAssigneeUsers(tenantId: string | null): Promise<MentionUser[]> {
  if (!tenantId) return [];
  return loadOrEmpty("assignees", () =>
    prisma.user.findMany({
      where: { memberships: { some: { tenantId } } },
      select: { id: true, name: true, role: true, image: true },
      orderBy: { name: "asc" },
    }),
  []);
}

/** The report form's data for the project in the URL (#project-urls): the slug picks it and checks access. */
export async function loadReportFormData(org: string, slug: string) {
  const { user, tenantId, project } = await requireProject(org, slug);
  const admin = (await currentTenantAccess(user.id, user.role)).admin;
  const [users, assigneeUsers, types] = await Promise.all([
    loadMentionUsers(tenantId),
    loadAssigneeUsers(tenantId),
    loadOrEmpty("issue types", () => getActiveIssueTypesCached(tenantId), []),
  ]);
  return { user, admin, users, assigneeUsers, types, projectId: project.id, projectSlug: project.ref };
}
