import Link from "next/link";
import "./create-issue.css";
import { CreateIssueForm } from "@/components/create-issue-form";
import { loadReportFormData } from "./load-form-data";
import { ideasPath } from "@/lib/project-paths";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Report an issue" };

/** `/<slug>/issues/new`: file a report into this project (#project-urls). */
export default async function NewBugPage({ params }: { params: Promise<{ org: string; project: string }> }) {
  const { org, project } = await params;
  const { user, admin, users, assigneeUsers, types, projectId, projectSlug } =
    await loadReportFormData(org, project);

  return (
    <div className="create-issue-page mx-auto w-full min-w-0 space-y-6 pb-10">
      <div className="create-issue-heading space-y-2">
        <Link
          href={ideasPath(projectSlug)}
          className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-zk-accent hover:underline"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to issues
        </Link>
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">Report an issue</h1>
        <p className="text-sm text-zk-text2">
          Give the team the full picture: what you did, what you expected, what
          happened instead.
        </p>
      </div>
      <div className="create-issue-card border border-zk-border bg-zk-surface">
        <CreateIssueForm
          users={users}
          assigneeUsers={assigneeUsers}
          types={types}
          isAdmin={admin}
          currentUserId={user.id}
          projectId={projectId}
          projectSlug={projectSlug}
        />
      </div>
    </div>
  );
}
