import { redirect } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { issuesPath } from "@/lib/project-paths";

/** `/<slug>/issues`: every issue, the All list. */
export default async function IssuesIndexPage({ params }: { params: Promise<{ org: string; project: string }> }) {
  const { org, project } = await params;
  const { project: resolved } = await requireProject(org, project);
  redirect(issuesPath(resolved.ref, "all"));
}
