import "../../../issues/new/create-issue.css";
import { ReportIssueModal } from "@/components/report-issue-modal";
import { safeReportedFrom } from "@/lib/reported-from";
import { loadReportFormData } from "../../../issues/new/load-form-data";

/**
 * Opening "Report an issue" from inside the app shows the quick report in a
 * modal over the current page. A direct visit or refresh of /<slug>/issues/new is not
 * intercepted and renders the full report page (#report-modal).
 */
export default async function ReportIssueModalRoute({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { org, project } = await params;
  const { from } = await searchParams;
  const { user, admin, users, assigneeUsers, types, projectId, projectSlug } =
    await loadReportFormData(org, project);

  return (
    <ReportIssueModal
      users={users}
      assigneeUsers={assigneeUsers}
      types={types}
      isAdmin={admin}
      currentUserId={user.id}
      projectId={projectId}
      projectSlug={projectSlug}
      reportedFrom={safeReportedFrom(Array.isArray(from) ? from[0] : from)}
    />
  );
}
