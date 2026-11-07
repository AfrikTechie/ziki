import type { SecuritySeverity, Status, Substatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canViewFinding, daysBetween, discloseLiveFindings, type FindingViewer } from "@/lib/security-findings";
import { SECURITY_SEVERITIES } from "@/lib/security-severity";
import { refOf, ideaPath, type ProjectRef } from "@/lib/project-paths";
import { issuePath } from "@/lib/issue-ref";
import { substatusLabel } from "@/lib/labels";

/**
 * What the Security page shows (#security-findings): the workspace's private
 * findings (titles only for who may see them), the ones already disclosed, and
 * the numbers on top. Severity counts and stages are shown to every member, as
 * they say how exposed the product is without saying how to exploit it.
 */

export type DashboardFinding = {
  id: string;
  severity: SecuritySeverity;
  /** The real title when the viewer may see it, else null. */
  title: string | null;
  canView: boolean;
  /** "Idea #12" or "#345", with where it links. */
  ref: string;
  href: string;
  project: string;
  /** Where it is in the workflow, e.g. "Waiting for verdicts" or "In progress". */
  stage: string;
  reportedAt: Date;
  /** Days since it was reported (private) or from report to disclosure (disclosed). */
  days: number;
  disclosedAt: Date | null;
  /** Disclosed because the fix went live, not by an admin early. */
  fixedLive: boolean;
};

export type SecurityDashboard = {
  open: DashboardFinding[];
  disclosed: DashboardFinding[];
  openBySeverity: Record<SecuritySeverity, number>;
  /** Median days from report to fix for findings disclosed because their fix went live; null with none. */
  medianDaysToFix: number | null;
  projects: { name: string; ref: ProjectRef }[];
};

const SEVERITY_ORDER: Record<SecuritySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function stageOf(row: { bug: { status: Status; substatus: Substatus } | null; idea: { status: string } | null }): string {
  if (row.bug) return substatusLabel[row.bug.substatus];
  if (row.idea?.status === "open") return "Waiting for verdicts";
  if (row.idea?.status === "rejected") return "Rejected";
  if (row.idea?.status === "archived") return "Archived";
  return "Reported";
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export async function loadSecurityDashboard(organisationId: string, viewer: FindingViewer, now: Date = new Date()): Promise<SecurityDashboard> {
  // A finding whose fix went live since the last sweep is published before the page reads it.
  await discloseLiveFindings({ organisationId });
  const [rows, projects] = await Promise.all([
    prisma.securityFinding.findMany({
      where: {
        organisationId,
        // A deleted issue or idea takes its finding off the page.
        OR: [{ bug: { isDeleted: false } }, { bugId: null, idea: { isDeleted: false } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
      select: {
        id: true, organisationId: true, reporterId: true, severity: true, title: true, createdAt: true, disclosedAt: true, disclosedById: true,
        project: { select: { name: true, slug: true, organisation: { select: { slug: true } } } },
        bug: { select: { number: true, status: true, substatus: true } },
        idea: { select: { number: true, status: true } },
      },
    }),
    prisma.project.findMany({
      where: { organisationId, archivedAt: null },
      orderBy: [{ name: "asc" }],
      select: { name: true, slug: true, organisation: { select: { slug: true } } },
    }),
  ]);

  const findings = rows.map((row): DashboardFinding => {
    const ref = refOf(row.project);
    const canView = canViewFinding(row, viewer);
    return {
      id: row.id,
      severity: row.severity,
      title: canView ? row.title : null,
      canView,
      ref: row.bug ? `#${row.bug.number}` : `Idea #${row.idea?.number ?? "?"}`,
      href: row.bug ? issuePath(ref, row.bug.number) : ideaPath(ref, row.idea?.number ?? 0),
      project: row.project.name,
      stage: stageOf(row),
      reportedAt: row.createdAt,
      days: daysBetween(row.createdAt, row.disclosedAt ?? now),
      disclosedAt: row.disclosedAt,
      fixedLive: row.disclosedAt !== null && row.disclosedById === null,
    };
  });

  const open = findings
    .filter((finding) => !finding.disclosedAt)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.reportedAt.getTime() - b.reportedAt.getTime());
  const disclosed = findings
    .filter((finding) => finding.disclosedAt)
    .sort((a, b) => (b.disclosedAt?.getTime() ?? 0) - (a.disclosedAt?.getTime() ?? 0));
  const openBySeverity = Object.fromEntries(SECURITY_SEVERITIES.map((level) => [level, 0])) as Record<SecuritySeverity, number>;
  for (const finding of open) openBySeverity[finding.severity] += 1;

  return {
    open,
    disclosed,
    openBySeverity,
    medianDaysToFix: median(disclosed.filter((finding) => finding.fixedLive).map((finding) => finding.days)),
    projects: projects.map((project) => ({ name: project.name, ref: refOf(project) })),
  };
}
