import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";
import { ensureDefaultIssueTypes, issueTypeScopeFor } from "@/lib/issue-types";
import { AdminIssueTypesManager } from "@/components/admin-issue-types-manager";
import { loadOrg } from "../org-context";
import { OrgPageHeader, ReadOnlyNameList, ReadOnlyNote } from "../org-ui";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Issue types" };

/** The organisation's issue types. Owners and admins manage them; members read them. */
export default async function OrgTypesPage() {
  const { user, org } = await loadOrg();
  if (!org) return null;

  const scope = await issueTypeScopeFor(user);
  if (!scope.ok) {
    const types = await prisma.issueType.findMany({
      where: { organisationId: org.id, ...PRODUCT_TRACK },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, isActive: true },
    });
    return (
      <div className="space-y-4">
        <OrgPageHeader title="Issue types">
          The kinds of issue people can file in {org.name}, such as Fix or Feat.
        </OrgPageHeader>
        <ReadOnlyNote>Only owners and admins can add, rename or retire issue types.</ReadOnlyNote>
        <ReadOnlyNameList
          label="Issue types"
          empty="This organisation has no issue types yet."
          items={types.map((type) => ({
            id: type.id,
            name: type.name,
            inactive: !type.isActive,
            hint: type.description,
          }))}
        />
      </div>
    );
  }

  await ensureDefaultIssueTypes(scope.organisationId);

  const [types, deletedRows] = await Promise.all([
    prisma.issueType.findMany({
      where: { organisationId: scope.organisationId, ...PRODUCT_TRACK },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { bugs: true },
        },
      },
    }),
    // Deleted issues block deletion but the list hides them.
    prisma.bug.groupBy({
      by: ["typeId"],
      where: { organisationId: scope.organisationId, isDeleted: true, typeId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const deletedCounts = Object.fromEntries(
    deletedRows.map((row) => [row.typeId as string, row._count._all]),
  );

  return <AdminIssueTypesManager types={types} deletedCounts={deletedCounts} />;
}
