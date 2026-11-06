import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { notFound, permanentRedirect } from "next/navigation";
import { projectFirstTarget, requireOrg } from "@/lib/project-route";
import { ideasPath, orgHomePath, projectRef } from "@/lib/project-paths";
import { ProjectBreadcrumb } from "@/components/project-breadcrumb";
import { NewProjectForm } from "./new-project-form";
import { HEALTH_LABEL, projectHealthFor, type CheckState, type HealthStatus } from "@/lib/project-health";

type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ health?: string | string[] }>;
};

export const metadata = { title: "Projects" };

const FILTERS: Array<{ value: HealthStatus | null; label: string }> = [
  { value: null, label: "All projects" },
  { value: "healthy", label: "Healthy" },
  { value: "at_risk", label: "At risk" },
  { value: "critical", label: "Critical" },
];

const DOT: Record<HealthStatus | "all", string> = {
  all: "bg-zk-muted",
  healthy: "bg-emerald-500",
  at_risk: "bg-amber-500",
  critical: "bg-red-500",
};
const RING: Record<HealthStatus, string> = { healthy: "text-emerald-600", at_risk: "text-amber-600", critical: "text-red-600" };
const CHIP: Record<HealthStatus, string> = {
  healthy: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  at_risk: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  critical: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};
const SUMMARY: Record<HealthStatus, string> = { healthy: "text-zk-text2", at_risk: "text-amber-700 dark:text-amber-300", critical: "text-red-700 dark:text-red-300" };
const BAR: Record<CheckState, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500" };

/**
 * `/<org>` (#project-health): every project of the organisation that has
 * issues, with its health, a 0–100 score from six checks on its work. A
 * project with no issues yet isn't listed. All Projects in the breadcrumb opens
 * it. Filter by Healthy, At risk or Critical. New project creates one here.
 *
 * An old `/<project>` address (from before organisations were in URLs,
 * #project-urls) goes on to that project's issue list.
 */
export default async function OrganisationProjectsPage({ params, searchParams }: Props) {
  const { org } = await params;
  const { user, tenant } = await requireOrg(org);
  if (!tenant) {
    const target = await projectFirstTarget(user, `/${org}/ideas`);
    if (target) permanentRedirect(target);
    notFound();
  }
  const tenantId = tenant.id;
  const rawFilter = (await searchParams).health;
  const filter = FILTERS.find((f) => f.value && f.value === (Array.isArray(rawFilter) ? rawFilter[0] : rawFilter))?.value ?? null;

  const allProjects = await prisma.project.findMany({
    where: { tenantId, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true, _count: { select: { bugs: { where: { isDeleted: false } } } } },
  });
  // A project with no issues yet has nothing to score: it isn't listed.
  const projects = allProjects.filter((p) => p._count.bugs > 0);
  const hiddenCount = allProjects.length - projects.length;
  const health = await projectHealthFor(tenantId, projects.map((p) => p.id));
  const rows = projects
    .map((p) => ({ id: p.id, slug: p.slug, name: p.name, health: health.get(p.id)! }))
    // The ones that need attention first.
    .sort((a, b) => a.health.score - b.health.score || a.name.localeCompare(b.name));
  const counts = (value: HealthStatus | null) => (value ? rows.filter((r) => r.health.status === value).length : rows.length);
  const shown = filter ? rows.filter((r) => r.health.status === filter) : rows;
  const filterHref = (value: HealthStatus | null) => orgHomePath(tenant.slug, value ? `health=${value}` : undefined);

  return (
    <>
    <ProjectBreadcrumb project={{ orgSlug: tenant.slug }} />
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Projects</h1>
          <p className="mt-1 text-sm text-zk-text2">
            {tenant.name}: health is scored from 0 to 100 from six checks on each project&apos;s work, as of now.
            {hiddenCount ? ` ${hiddenCount === 1 ? "1 project with no issues yet isn't" : `${hiddenCount} projects with no issues yet aren't`} listed.` : ""}
          </p>
        </div>
        {allProjects.length ? <NewProjectForm /> : null}
      </header>

      {allProjects.length ? null : (
        <div className="space-y-3">
          <p className="text-sm text-zk-text2">{tenant.name} has no projects yet. Create the first one to start collecting ideas and issues.</p>
          <NewProjectForm startOpen />
        </div>
      )}

      <nav aria-label="Filter by health" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FILTERS.map((f) => {
          const selected = f.value === filter;
          return (
            <Link
              key={f.label}
              href={filterHref(f.value)}
              aria-current={selected ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-2xl border bg-zk-surface px-4 py-3.5 transition hover:border-zk-text2 ${selected ? "border-electric-blue-strong ring-2 ring-electric-blue-strong/20" : "border-zk-border"}`}
            >
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[f.value ?? "all"]}`} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zk-text">{f.label}</span>
              <span className="text-2xl font-extrabold tabular-nums text-zk-text">{counts(f.value)}</span>
            </Link>
          );
        })}
      </nav>

      {shown.length ? (
        <ul className="space-y-3">
          {shown.map((row) => (
            <li key={row.id}>
              <Link
                href={ideasPath(projectRef(tenant.slug, row.slug))}
                className="group flex items-center gap-5 rounded-2xl border border-zk-border bg-zk-surface px-5 py-4 transition hover:border-electric-blue-strong/60 hover:shadow-sm"
              >
                <ScoreRing score={row.health.score} status={row.health.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-lg font-bold text-zk-text">{row.name}</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${CHIP[row.health.status]}`}>
                      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[row.health.status]}`} />
                      {HEALTH_LABEL[row.health.status]}
                    </span>
                  </div>
                  <p className={`mt-0.5 truncate text-sm ${SUMMARY[row.health.status]}`}>{row.health.summary}</p>
                  <ul aria-label="Checks" className="mt-2 flex gap-1.5">
                    {row.health.checks.map((c) => (
                      <li key={c.key} title={`${c.label}: ${c.state === "ok" ? "passing" : c.message}`} className={`h-1 w-5 rounded-full ${BAR[c.state]}`}>
                        <span className="sr-only">{c.label}: {c.state === "ok" ? "passing" : c.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-zk-muted transition group-hover:translate-x-0.5"><path d="m9 6 6 6-6 6" /></svg>
              </Link>
            </li>
          ))}
        </ul>
      ) : allProjects.length ? (
        <p className="rounded-2xl border border-dashed border-zk-border px-5 py-8 text-center text-sm text-zk-muted">
          {filter ? `No ${HEALTH_LABEL[filter].toLowerCase()} projects right now.` : "No project has issues yet."}
        </p>
      ) : null}
    </div>
    </>
  );
}

/** The score in a ring that fills to it. */
function ScoreRing({ score, status }: { score: number; status: HealthStatus }) {
  const radius = 22;
  const length = 2 * Math.PI * radius;
  return (
    <span className={`relative grid h-14 w-14 shrink-0 place-items-center ${RING[status]}`}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle cx="28" cy="28" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="5" />
        <circle cx="28" cy="28" r={radius} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - score / 100)} />
      </svg>
      <span className="text-lg font-extrabold tabular-nums">
        {score}
        <span className="sr-only"> out of 100</span>
      </span>
    </span>
  );
}
