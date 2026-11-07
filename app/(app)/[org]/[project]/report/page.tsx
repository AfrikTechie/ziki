import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicIdeaForm } from "@/components/public-idea-form";
import { findPublicProject } from "@/lib/public-projects";
import { publicProjectPath } from "@/lib/public-project-paths";
import { NOINDEX } from "@/lib/seo/site";
import "../issues/new/create-issue.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Submit an issue", robots: NOINDEX };

export default async function PublicReportPage({ params }: { params: Promise<{ org: string; project: string }> }) {
  const { org, project: projectSlug } = await params;
  const ref = { orgSlug: org, projectSlug };
  const project = await findPublicProject(ref, { requireGuestIntake: true });
  if (!project) notFound();

  return (
    <div className="create-issue-page mx-auto w-full min-w-0 space-y-6 pb-10">
      <div className="create-issue-heading space-y-2">
        <Link
          href={publicProjectPath(ref)}
          className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-zk-accent hover:underline"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to {project.name}
        </Link>
        <h1>Report an issue</h1>
        <p>Give the team the full picture: what you did, what you expected, and what happened instead.</p>
      </div>
      <section className="create-issue-card border border-zk-border bg-zk-surface">
        <PublicIdeaForm orgSlug={org} projectSlug={projectSlug} />
      </section>
    </div>
  );
}
