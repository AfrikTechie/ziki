import Link from "next/link";
import { loadMilestoneSummaries, milestoneScopeFor } from "@/lib/milestone-stats";
import { dueDateValue } from "@/lib/milestones";
import { MilestoneManager } from "@/components/milestone-manager";
import { loadOrg } from "../org-context";
import { OrgPageHeader, ReadOnlyNote } from "../org-ui";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Milestones" };

/** The organization's milestones. Owners and admins manage them; everyone reads them on /milestones. */
export default async function OrgMilestonesPage() {
  const { user, org } = await loadOrg();
  if (!org) return null;

  const header = (
    <OrgPageHeader
      title="Milestones"
      actions={
        <Link href="/milestones" className="text-sm font-medium text-zk-accent hover:underline">
          See progress on milestones
        </Link>
      }
    >
      Group {org.name}&apos;s issues into a release or sprint. Closing a milestone keeps its issues;
      deleting one removes them from it without deleting them.
    </OrgPageHeader>
  );

  const scope = await milestoneScopeFor(user);
  if (!scope.ok) {
    return (
      <div className="space-y-4">
        {header}
        <ReadOnlyNote>
          Only owners and admins can create, close or delete milestones. Everyone can follow their
          progress on the milestones page.
        </ReadOnlyNote>
      </div>
    );
  }

  const milestones = await loadMilestoneSummaries({ tenantId: scope.tenantId });

  return (
    <div className="space-y-6">
      {header}
      <MilestoneManager
        milestones={milestones.map((m) => ({ ...m, dueDate: dueDateValue(m.dueDate) || null }))}
      />
    </div>
  );
}
