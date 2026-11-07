import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CopyProjectIdButton } from "@/app/(app)/projects/copy-project-id";
import { ideasPath, issuesPath, projectRef } from "@/lib/project-paths";
import { NewProjectButton } from "@/app/(app)/[org]/new-project-form";
import {
  deleteProjectAction,
  setProjectArchivedAction,
} from "@/app/(app)/projects/actions";
import { MissionCoverage } from "@/app/(app)/projects/mission-coverage";
import { ProjectRewardRulesDisplay } from "@/components/project-reward-rules-display";
import {
  getPlatformRewardConfig,
  projectDefaultsFromPlatform,
} from "@/lib/points/platform-rewards";
import { parseProjectRewardConfig } from "@/lib/points/project-rewards";
import { loadOrg } from "../org-context";
import { OrgMessages, OrgPageHeader, oneParam } from "../org-ui";

/* Distinct browser-tab title; the root layout appends the site name. */
export const metadata = { title: "Projects" };

/**
 * The organisation's one projects list: switch, create, and, for owners and
 * admins, each project's settings. Owners archive and delete projects.
 */
export default async function OrgProjectsPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ error?: string | string[]; notice?: string | string[] }>;
}) {
  // The project the URL is in is the one marked current (#project-urls).
  const { project: currentSlug } = await routeParams;
  const { org } = await loadOrg();
  if (!org) return null;
  const params = await searchParams;
  const organisationId = org.id;
  const canManageProjects = org.admin;
  const isOwner = org.owner;

  const [projects, platformRewards] = await Promise.all([
    prisma.project.findMany({
      where: { organisationId },
      select: {
        id: true,
        name: true,
        slug: true,
        archivedAt: true,
        createdAt: true,
        rewardConfig: true,
        githubInstallationId: true,
        _count: { select: { bugs: true } },
        testMissions: {
          select: {
            id: true,
            routePattern: true,
            brief: true,
            role: true,
            viewport: true,
            lastCoveredAt: true,
            issuesFiled: true,
          },
          orderBy: [{ routePattern: "asc" }, { role: "asc" }, { viewport: "asc" }],
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    getPlatformRewardConfig(prisma),
  ]);
  const platformDefaults = projectDefaultsFromPlatform(platformRewards);
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const archivedProjects = projects.filter((project) => project.archivedAt);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <OrgPageHeader title="Projects">
        A project is one product inside {org.name}, such as a web app. The issue list follows the
        project selected in the bar.{canManageProjects ? " Open a project's settings for its workflow, areas and GitHub App." : ""}
      </OrgPageHeader>

      <OrgMessages error={oneParam(params.error)} notice={oneParam(params.notice)} />

      <div>
        <NewProjectButton orgSlug={org.slug} defaults={platformDefaults} />
      </div>

      <section className="overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
        <div className="border-b border-zk-border bg-zk-tint px-4 py-3 sm:px-6">
          <h3 className="text-base font-semibold text-zk-text">
            Your projects
          </h3>
          <p className="mt-0.5 text-xs text-zk-muted">
            Switching here also changes the project shown in the header.
          </p>
        </div>
        {activeProjects.length === 0 ? (
          archivedProjects.length > 0 ? (
            <p className="px-4 py-6 text-sm text-zk-text2 sm:px-6">
              No active projects. Restore one below or create a new one.
            </p>
          ) : (
            <div className="space-y-2 px-4 py-6 text-sm text-zk-text2 sm:px-6">
              <p className="font-medium text-zk-text">No projects yet. Create the first one above.</p>
              <p>
                Make one project per product you track, so each gets its own issues. For example, a
                software team might have <span className="font-medium">Web app</span>,{" "}
                <span className="font-medium">iOS app</span> and <span className="font-medium">Desktop app</span>;
                an agency might have one per client.
              </p>
              <p>
                Each project also gets a short id made from its name (Web app → <code>web-app</code>), used in
                links and by agents.
              </p>
            </div>
          )
        ) : (
          <ul className="divide-y divide-zk-border">
            {activeProjects.map((project) => {
              const active = project.slug === decodeURIComponent(currentSlug);
              return (
                <li
                  key={project.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-zk-text">
                      <span className="truncate">{project.name}</span>
                      {active ? (
                        <Badge className="rounded-full bg-zk-tint text-zk-accent ring-1 ring-zk-border">
                          Active
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-zk-muted">
                      {project.slug} · {project._count.bugs}{" "}
                      {project._count.bugs === 1 ? "issue" : "issues"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-zk-muted">Project ID:</span>
                      <code className="rounded bg-zk-chip px-1.5 py-0.5 font-mono text-[11px] text-zk-text2">
                        {project.id}
                      </code>
                      <CopyProjectIdButton projectId={project.id} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className={project.githubInstallationId ? "font-semibold text-zk-ok-fg" : "text-zk-muted"}>
                        {project.githubInstallationId ? "GitHub App connected" : "GitHub App not connected"}
                      </span>
                      {canManageProjects ? (
                        <>
                          <Link href={`/projects/${encodeURIComponent(project.slug)}/settings`} className="font-medium text-zk-accent hover:underline">
                            Settings
                          </Link>
                          <Link href={`/projects/${encodeURIComponent(project.slug)}/settings/github`} className="font-medium text-zk-accent hover:underline">
                            GitHub
                          </Link>
                        </>
                      ) : null}
                      <Link href={issuesPath(projectRef(org.slug, project.slug), "all")} className="font-medium text-zk-accent hover:underline">
                        Issues
                      </Link>
                    </div>
                    <div className="mt-3">
                      <ProjectRewardRulesDisplay
                        rewardConfig={parseProjectRewardConfig(project.rewardConfig, platformDefaults)}
                        defaults={platformDefaults}
                        customized={Boolean(project.rewardConfig)}
                      />
                    </div>
                    <MissionCoverage
                      projectId={project.id}
                      canManage={canManageProjects}
                      missions={project.testMissions.map((mission) => ({
                        ...mission,
                        lastCoveredAt: mission.lastCoveredAt?.toISOString() ?? null,
                      }))}
                    />

                    {isOwner ? (
                      <details className="mt-3 text-xs text-zk-text2">
                        <summary className="cursor-pointer font-medium text-zk-text2">
                          Archive or delete
                        </summary>
                        <div className="mt-2 space-y-4 rounded-xl border border-zk-border bg-zk-tint p-3">
                          <form action={setProjectArchivedAction}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="archived" value="true" />
                            <ConfirmSubmitButton
                              variant="secondary"
                              confirm={{
                                title: `Archive ${project.name}?`,
                                body: "It leaves the project switcher and can't be selected. Its issues stay, and you can restore it later.",
                                confirmLabel: "Archive project",
                              }}
                            >
                              Archive project
                            </ConfirmSubmitButton>
                          </form>

                          <form action={deleteProjectAction} className="space-y-1">
                            <input type="hidden" name="projectId" value={project.id} />
                            <p className="font-medium text-zk-text2">Delete project</p>
                            <p>
                              Only works when the project has no issues. Otherwise archive it.
                            </p>
                            <label
                              htmlFor={`confirm-delete-${project.id}`}
                              className="block text-xs text-zk-text2"
                            >
                              Type {project.name} to confirm deleting it
                            </label>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                id={`confirm-delete-${project.id}`}
                                name="confirmName"
                                placeholder={`Type ${project.name}`}
                                autoComplete="off"
                                required
                                className="min-w-0 flex-1 rounded-xl border border-zk-border px-2 py-1 text-sm text-zk-text"
                              />
                              <Button type="submit" variant="danger-secondary">
                                Delete project
                              </Button>
                            </div>
                          </form>
                        </div>
                      </details>
                    ) : null}
                  </div>
                  {active ? null : (
                    <Link
                      href={ideasPath(projectRef(org.slug, project.slug))}
                      className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-card px-3.5 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    >
                      Switch to {project.name}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isOwner && archivedProjects.length > 0 ? (
        <section className="overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
          <div className="border-b border-zk-border bg-zk-tint px-4 py-3 sm:px-6">
            <h3 className="text-base font-semibold text-zk-text">Archived projects</h3>
            <p className="mt-0.5 text-xs text-zk-muted">
              Archived projects are hidden from the switcher and can&apos;t be selected.
              Restore one to use it again.
            </p>
          </div>
          <ul className="divide-y divide-zk-border">
            {archivedProjects.map((project) => (
              <li key={project.id} className="space-y-3 px-4 py-3 sm:px-6">
                <div>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zk-text">
                    <span className="truncate">{project.name}</span>
                    <Badge className="rounded-full bg-zk-warn-bg text-zk-warn-fg ring-1 ring-zk-warn-bd">
                      Archived
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-zk-muted">
                    {project.slug} · {project._count.bugs}{" "}
                    {project._count.bugs === 1 ? "issue" : "issues"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={setProjectArchivedAction}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="archived" value="false" />
                    <Button type="submit" variant="secondary">
                      Restore {project.name}
                    </Button>
                  </form>
                  <form action={deleteProjectAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input
                      id={`confirm-delete-archived-${project.id}`}
                      name="confirmName"
                      aria-label={`Type ${project.name} to confirm deleting it`}
                      placeholder={`Type ${project.name}`}
                      autoComplete="off"
                      required
                      className="rounded-xl border border-zk-border px-2 py-1 text-sm text-zk-text"
                    />
                    <Button type="submit" variant="danger-secondary">
                      Delete {project.name}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
