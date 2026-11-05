import type { Metadata } from "next";
import { fetchDashboard } from "@/lib/dashboard-queries";
import { formatDateParam, formatDuration, parseDateRange } from "@/lib/dashboard-range";
import { statusLabel } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { BreakdownCard, RangePicker, Stat, WeeklyChart } from "./dashboard-parts";
import { orgPath, projectRef } from "@/lib/project-paths";
import { loadOrg } from "./org-context";
import { OrgPageHeader, oneParam } from "./org-ui";

/* Static on purpose: a title built from the name could leak into shared history. */
export const metadata: Metadata = { title: "Organization" };

/** People, projects and agents in one organization, counted in the database. */
async function orgCounts(tenantId: string) {
  try {
    const [members, projects, agents] = await Promise.all([
      prisma.membership.count({ where: { tenantId } }),
      prisma.project.count({ where: { tenantId, archivedAt: null } }),
      prisma.agent.count({ where: { tenantId, revokedAt: null } }),
    ]);
    return { members, projects, agents };
  } catch (error) {
    console.error("[org] counts failed", error);
    return null;
  }
}

/**
 * The organization's overview: who and what is in it, and how its issues
 * moved over a date range. Every figure is this organization's only.
 */
export default async function OrgOverviewPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const { org } = await loadOrg();
  if (!org) return null;

  const params = await searchParams;
  const range = parseDateRange({ from: oneParam(params.from), to: oneParam(params.to) });
  const [counts, data] = await Promise.all([orgCounts(org.id), fetchDashboard(org.id, range)]);
  const statusTotal = data.byStatus.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="space-y-6">
      <OrgPageHeader title="Overview">
        Issues in {org.name} created between{" "}
        <span className="font-medium text-zk-text">{formatDateParam(range.from)}</span> and{" "}
        <span className="font-medium text-zk-text">
          {formatDateParam(new Date(range.to.getTime() - 86400000))}
        </span>
        . Deleted issues are excluded.
      </OrgPageHeader>

      <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <Stat label="Members" value={counts ? String(counts.members) : "—"} />
        <Stat label="Active projects" value={counts ? String(counts.projects) : "—"} />
        <Stat label="Agents" value={counts ? String(counts.agents) : "—"} />
      </dl>

      <RangePicker range={range} basePath={orgPath(projectRef((await routeParams).org, (await routeParams).project))} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Opened" value={String(data.totalOpened)} />
        <Stat label="Closed" value={String(data.totalClosed)} />
        <Stat
          label="Median time to first reply"
          value={formatDuration(data.medianFirstResponseSeconds) ?? "—"}
          hint={data.medianFirstResponseSeconds === null ? "Nothing in range has a reply yet" : undefined}
        />
        <Stat
          label="Median time to resolution"
          value={formatDuration(data.medianResolutionSeconds) ?? "—"}
          hint={data.medianResolutionSeconds === null ? "Nothing in range has been resolved yet" : undefined}
        />
      </dl>

      <WeeklyChart points={data.weekly} />

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownCard
          title="By status"
          rows={data.byStatus.map((s) => ({
            label: statusLabel[s.status as keyof typeof statusLabel] ?? s.status,
            count: s.count,
          }))}
          total={statusTotal}
        />
        <BreakdownCard title="By project" rows={data.byProject} total={statusTotal} />
      </div>

      <BreakdownCard title="By type" rows={data.byType} total={statusTotal} wide />
    </div>
  );
}
