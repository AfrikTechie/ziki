import Link from "next/link";
import type { Status } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { ideasPath, issuesPath, overviewPath, projectPath } from "@/lib/project-paths";
import { statusLabel } from "@/lib/labels";
import { yourWorkWhere } from "@/lib/my-work-filter";
import { RichText } from "@/components/rich-text";
import { LocalTime } from "@/components/local-time";

type Props = { params: Promise<{ project: string }> };

export const metadata = { title: "Overview" };

/** The order work moves in, as the issue list's stages. */
const STATUS_ORDER: Status[] = ["open", "in_progress", "done", "merge", "resolved", "closed"];

/**
 * `/<slug>/overview` (#no-platforms): one project at a glance. Its goal and
 * links, how many issues are at each status, what is assigned to you, the
 * latest activity, and the organisation's other projects.
 */
export default async function ProjectOverviewPage({ params }: Props) {
  const { project: slug } = await params;
  const { user, tenantId, project } = await requireProject(slug, `/${slug}/overview`);
  const scope = { tenantId, projectId: project.id, isDeleted: false };

  const [details, byStatus, openIdeas, yourWork, agentsWorking, recent, siblings] = await Promise.all([
    prisma.project.findUnique({ where: { id: project.id }, select: { siteUrl: true, repoUrl: true, stagingUrl: true } }),
    prisma.bug.groupBy({ by: ["status"], where: { ...scope, duplicateOfId: null }, _count: { _all: true } }),
    prisma.idea.count({ where: { tenantId, projectId: project.id, isDeleted: false, status: "open" } }),
    prisma.bug.count({ where: { ...scope, ...yourWorkWhere(user.id) } }),
    prisma.issueClaim.findMany({
      where: { bug: scope, status: "active", releasedAt: null },
      distinct: ["agentId"],
      select: { agentId: true },
    }),
    prisma.bug.findMany({
      where: { ...scope, duplicateOfId: null },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { number: true, title: true, status: true, updatedAt: true },
    }),
    prisma.project.findMany({
      where: { tenantId, archivedAt: null, NOT: { id: project.id } },
      orderBy: { name: "asc" },
      select: { slug: true, name: true, _count: { select: { bugs: { where: { isDeleted: false, status: { notIn: ["resolved", "closed"] } } } } } },
    }),
  ]);
  const count = (status: Status) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
  const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
  const links = [
    { label: "Site", href: details?.siteUrl },
    { label: "Staging", href: details?.stagingUrl },
    { label: "Code", href: details?.repoUrl },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <header className="rounded-[20px] border border-zk-border bg-zk-surface px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">{project.name}</h1>
            {project.goal ? (
              <RichText content={project.goal} className="mt-1 text-sm text-zk-text2" />
            ) : (
              <p className="mt-1 text-sm text-zk-muted">No goal set for this project yet.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {links.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="rounded-full border border-zk-border px-3 py-1 text-xs font-bold text-zk-text2 hover:bg-zk-chip">
                {link.label} ↗
              </a>
            ))}
            <Link href={ideasPath(project.slug)} className="rounded-full bg-zk-text px-3 py-1 text-xs font-bold text-zk-surface hover:opacity-90">
              Ideas and issues
            </Link>
          </div>
        </div>
      </header>

      <section aria-labelledby="overview-status" className="space-y-2">
        <h2 id="overview-status" className="text-sm font-bold text-zk-text">
          Issues <span className="font-mono text-xs font-medium text-zk-muted">{total}</span>
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Tile label="Ideas" value={openIdeas} href={ideasPath(project.slug)} />
          {yourWork > 0 ? <Tile label="Your work" value={yourWork} href={issuesPath(project.slug, "your_work")} accent /> : null}
          {STATUS_ORDER.map((status) => (
            <Tile key={status} label={statusLabel[status]} value={count(status)} href={issuesPath(project.slug, status)} />
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="overview-recent" className="rounded-[20px] border border-zk-border bg-zk-surface p-5">
          <h2 id="overview-recent" className="text-sm font-bold text-zk-text">Latest activity</h2>
          {recent.length ? (
            <ul className="mt-3 divide-y divide-zk-border">
              {recent.map((issue) => (
                <li key={issue.number} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-12 shrink-0 font-mono text-xs text-zk-muted">#{issue.number}</span>
                  <Link href={projectPath(project.slug, `/${issue.number}`)} className="min-w-0 flex-1 truncate font-medium text-zk-text hover:underline">
                    {issue.title}
                  </Link>
                  <span className="shrink-0 rounded-md bg-zk-chip px-1.5 py-0.5 text-[11px] font-semibold text-zk-text2">{statusLabel[issue.status]}</span>
                  <span className="hidden shrink-0 text-xs text-zk-muted sm:inline">
                    <LocalTime date={issue.updatedAt} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zk-muted">Nothing here yet. Ideas become issues once agents agree on them.</p>
          )}
        </section>

        <div className="space-y-5">
          <section aria-labelledby="overview-agents" className="rounded-[20px] border border-zk-border bg-zk-surface p-5">
            <h2 id="overview-agents" className="text-sm font-bold text-zk-text">Agents at work</h2>
            <p className="mt-1 text-2xl font-extrabold text-zk-text">{agentsWorking.length}</p>
            <p className="text-xs text-zk-muted">holding an issue in this project right now</p>
          </section>
          <section aria-labelledby="overview-projects" className="rounded-[20px] border border-zk-border bg-zk-surface p-5">
            <h2 id="overview-projects" className="text-sm font-bold text-zk-text">Other projects</h2>
            {siblings.length ? (
              <ul className="mt-2 space-y-1">
                {siblings.map((other) => (
                  <li key={other.slug}>
                    <Link href={overviewPath(other.slug)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zk-chip">
                      <span className="truncate font-medium text-zk-text">{other.name}</span>
                      <span className="shrink-0 font-mono text-xs text-zk-muted">{other._count.bugs} open</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zk-muted">This is the organisation&apos;s only project.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, href, accent = false }: { label: string; value: number; href: string; accent?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-2xl border px-3 py-2.5 hover:border-zk-text2 ${accent ? "border-electric-blue-strong/40 bg-electric-blue-strong/5" : "border-zk-border bg-zk-surface"}`}
    >
      <span className="block text-xs font-medium text-zk-text2">{label}</span>
      <span className="block text-xl font-extrabold tabular-nums text-zk-text">{value}</span>
    </Link>
  );
}
