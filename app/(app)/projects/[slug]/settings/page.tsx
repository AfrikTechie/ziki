import Link from "next/link";
import { issuesPath, orgPath, refOf } from "@/lib/project-paths";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { isTenantAdmin } from "@/lib/agents/membership";
import { prisma } from "@/lib/prisma";
import { ProjectSettingsForm } from "./settings-form";
import { ProjectAreasManager } from "./areas-manager";
import { WorkflowSettingsForm } from "./workflow-settings-form";
import { workflowValues } from "@/lib/workflow-config";
import {
  getPlatformRewardConfig,
  projectDefaultsFromPlatform,
} from "@/lib/points/platform-rewards";

export const metadata = { title: "Project settings" };

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ github?: string }>;
}) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) redirect("/tenants");
  if (!(await isTenantAdmin(user, tenantId))) notFound();
  const { slug } = await params;
  const project = await prisma.project.findFirst({
    where: { tenantId, slug },
    select: {
      id: true, slug: true, name: true, goal: true, repoUrl: true, stagingUrl: true, siteUrl: true,
      githubInstallationId: true, rewardConfig: true, workflow: true, tenant: { select: { slug: true } },
    },
  });
  if (!project) notFound();
  const workflow = workflowValues(project.workflow);
  const areas = await prisma.projectArea.findMany({
    where: { projectId: project.id },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, slug: true, description: true, paths: true },
  });
  const platformRewards = await getPlatformRewardConfig(prisma);
  const platformDefaults = projectDefaultsFromPlatform(platformRewards);
  const { github } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link href={orgPath(refOf(project), "projects")} className="text-sm text-zk-accent hover:underline">← Projects</Link>
        <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">{project.name} settings</h1>
        <p className="text-sm text-zk-text2">Owners and admins can update project details and connect its GitHub App installation.</p>
      </div>
      {github === "error" ? <p role="alert" className="rounded-[14px] bg-zk-warn-bg p-3 text-sm text-zk-warn-fg">GitHub setup could not be completed. Start the connection again from this page.</p> : null}
      {github === "connected" ? <p role="status" className="rounded-[14px] bg-zk-ok-bg p-3 text-sm text-zk-ok-fg">GitHub App installation connected.</p> : null}
      {github === "unavailable" ? <p role="alert" className="rounded-[14px] bg-zk-warn-bg p-3 text-sm text-zk-warn-fg">The GitHub App is not configured. Set GITHUB_APP_SLUG before connecting it.</p> : null}
      {github === "requested" ? <p role="status" className="rounded-[14px] bg-zk-warn-bg p-3 text-sm text-zk-warn-fg">GitHub App installation was requested and is waiting for organization admin approval.</p> : null}
      {github === "cancelled" ? <p role="status" className="rounded-[14px] bg-zk-surface p-3 text-sm text-zk-text2">GitHub App connection was cancelled.</p> : null}
      <section className="space-y-5 rounded-[20px] border border-zk-border bg-zk-surface p-4 sm:p-6">
        <ProjectSettingsForm project={project} defaults={platformDefaults} />
        <div className="border-t border-zk-border pt-5">
          <h2 className="text-base font-semibold text-zk-text">GitHub App</h2>
          <p className="mt-1 text-sm text-zk-text2">Installation ID: {project.githubInstallationId ?? "Not connected"}. No access token is stored.</p>
          <div className="mt-3">
            <a
              href={`/projects/${encodeURIComponent(project.slug)}/settings/github`}
              className="inline-flex items-center justify-center rounded-full bg-teal-700 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              {project.githubInstallationId ? "Change installation" : "Connect GitHub App"}
            </a>
          </div>
        </div>
      </section>
      <section className="space-y-5 rounded-[20px] border border-zk-border bg-zk-surface p-4 sm:p-6" aria-labelledby="workflow-heading">
        <div>
          <h2 id="workflow-heading" className="text-base font-semibold text-zk-text">Workflow</h2>
          <p className="mt-1 text-sm text-zk-text2">
            The gates agents work under in this project. Changes are audited.
          </p>
        </div>
        <WorkflowSettingsForm slug={project.slug} workflow={workflow} />
      </section>
      <ProjectAreasManager projectSlug={project.slug} areas={areas} />
      <Link href={issuesPath(refOf(project))} className="inline-block text-sm text-zk-accent hover:underline">Back to issues</Link>
    </div>
  );
}
