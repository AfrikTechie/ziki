import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationAccess } from "@/lib/organisation-access";
import { prisma } from "@/lib/prisma";
import { loadSecurityDashboard, type DashboardFinding } from "@/lib/security-dashboard";
import { SECURITY_SEVERITIES, SEVERITY_GUIDE } from "@/lib/security-severity";
import { newIssuePath, type ProjectRef } from "@/lib/project-paths";
import { SeverityChip } from "@/components/security-finding-panel";
import { AgentClearanceToggle } from "@/components/security-finding-controls";
import { LocalTime } from "@/components/local-time";

export const metadata = { title: "Security" };

/**
 * The Security area (#security-findings): report a vulnerability privately,
 * see how exposed the workspace is, follow each finding to its fix, and read
 * the ones already disclosed. Owners and admins also choose which agents may
 * read private findings.
 */
export default async function SecurityPage() {
  const user = await requireUser();
  const access = await currentOrganisationAccess(user.id, user.role);
  if (!access.organisationId) {
    return (
      <section className="mx-auto max-w-xl rounded-[24px] border border-zk-border bg-zk-surface p-8 text-center">
        <h1 className="text-[28px] font-extrabold text-zk-text">Security</h1>
        <p className="mt-2 text-sm text-zk-text2">Join or create a workspace to report and track security findings.</p>
      </section>
    );
  }
  const organisationId = access.organisationId;
  const dashboard = await loadSecurityDashboard(organisationId, { kind: "person", userId: user.id, organisationId, organisationAdmin: access.admin });
  const agents = access.admin
    ? (
        await prisma.agentActivation.findMany({
          where: { organisationId, deactivatedAt: null, agent: { revokedAt: null } },
          orderBy: [{ securityCleared: "desc" }, { agent: { name: "asc" } }],
          take: 200,
          select: { level: true, securityCleared: true, agent: { select: { id: true, name: true, owner: { select: { name: true } } } } },
        })
      ).map(({ agent, level, securityCleared }) => ({ ...agent, level, securityCleared }))
    : [];
  const openCount = dashboard.open.length;
  const severe = dashboard.openBySeverity.critical + dashboard.openBySeverity.high;

  return (
    <div className="security-page mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">Security</h1>
          <p className="max-w-2xl text-sm text-zk-text2">
            Report vulnerabilities privately. A finding&apos;s details stay with the reporter, this workspace&apos;s owners and
            admins, and agents cleared for security work until the fix is live. Then they are published for everyone.
          </p>
        </div>
        <ReportButton projects={dashboard.projects} />
      </header>

      <section aria-label="Summary" className="security-stats grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open findings" value={String(openCount)} hint={openCount ? "Private until fixed" : "Nothing open"} />
        <Stat
          label="Critical and high"
          value={String(severe)}
          hint={`${dashboard.openBySeverity.critical} critical, ${dashboard.openBySeverity.high} high`}
          alert={severe > 0}
        />
        <Stat label="Fixed and disclosed" value={String(dashboard.disclosed.length)} hint="Details now public" />
        <Stat
          label="Median time to fix"
          value={dashboard.medianDaysToFix === null ? "–" : `${dashboard.medianDaysToFix} d`}
          hint="From report to live fix"
        />
      </section>

      <section aria-labelledby="open-heading" className="rounded-[20px] border border-zk-border bg-zk-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="open-heading" className="text-lg font-bold text-zk-text">Open findings</h2>
          <p className="text-xs text-zk-muted">Worst first, then oldest.</p>
        </div>
        {dashboard.open.length ? (
          <FindingTable findings={dashboard.open} kind="open" />
        ) : (
          <p className="mt-3 text-sm text-zk-text2">No open security findings. Found something? Report it privately.</p>
        )}
      </section>

      <section aria-labelledby="disclosed-heading" className="rounded-[20px] border border-zk-border bg-zk-surface p-5">
        <h2 id="disclosed-heading" className="text-lg font-bold text-zk-text">Disclosed</h2>
        {dashboard.disclosed.length ? (
          <FindingTable findings={dashboard.disclosed} kind="disclosed" />
        ) : (
          <p className="mt-3 text-sm text-zk-text2">Findings appear here once their fix is live and their details are published.</p>
        )}
      </section>

      <section aria-labelledby="severity-heading" className="rounded-[20px] border border-zk-border bg-zk-surface p-5">
        <h2 id="severity-heading" className="text-lg font-bold text-zk-text">How to rate severity</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {SECURITY_SEVERITIES.map((level) => (
            <div key={level} className="space-y-1">
              <dt><SeverityChip severity={level} /></dt>
              <dd className="text-sm text-zk-text2">{SEVERITY_GUIDE[level]}</dd>
            </div>
          ))}
        </dl>
      </section>

      {access.admin ? (
        <section aria-labelledby="agents-heading" className="rounded-[20px] border border-zk-border bg-zk-surface p-5">
          <h2 id="agents-heading" className="text-lg font-bold text-zk-text">Agents cleared for security work</h2>
          <p className="mt-1 text-sm text-zk-text2">
            A cleared agent can read every private finding in this workspace, through the API and its files, so it can
            confirm, fix and test them. Only owners and admins see this list. An agent can always read findings its own
            owner reported.
          </p>
          {agents.length ? (
            <ul className="mt-3 divide-y divide-zk-border">
              {agents.map((agent) => (
                <li key={agent.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold text-zk-text">{agent.name}</span>{" "}
                    <span className="text-zk-muted">
                      {agent.level} agent of {agent.owner?.name ?? "someone"}
                    </span>
                  </span>
                  <AgentClearanceToggle agentId={agent.id} agentName={agent.name} cleared={agent.securityCleared} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zk-text2">No agents in this workspace yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint, alert = false }: { label: string; value: string; hint: string; alert?: boolean }) {
  return (
    <div className={`security-stat rounded-[16px] border border-zk-border bg-zk-surface p-4${alert ? " security-stat--alert" : ""}`}>
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">{label}</p>
      <p className="mt-1 text-[28px] font-extrabold tabular-nums leading-none text-zk-text">{value}</p>
      <p className="mt-1 text-xs text-zk-text2">{hint}</p>
    </div>
  );
}

function FindingTable({ findings, kind }: { findings: DashboardFinding[]; kind: "open" | "disclosed" }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="security-table w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-zk-muted">
            <th scope="col" className="py-2 pr-3 font-semibold">Severity</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Finding</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Stage</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">{kind === "open" ? "Open for" : "Took"}</th>
            {kind === "disclosed" ? <th scope="col" className="py-2 font-semibold">Disclosed</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-zk-border">
          {findings.map((finding) => (
            <tr key={finding.id}>
              <td className="py-2 pr-3 align-top"><SeverityChip severity={finding.severity} /></td>
              <td className="py-2 pr-3 align-top">
                <Link href={finding.href} className="font-semibold text-zk-accent hover:underline">{finding.ref}</Link>{" "}
                {finding.title ? (
                  <span className="text-zk-text">{finding.title}</span>
                ) : (
                  <span className="italic text-zk-muted">Details restricted</span>
                )}
                <span className="block text-xs text-zk-muted">{finding.project}</span>
              </td>
              <td className="py-2 pr-3 align-top text-zk-text2">{finding.stage}</td>
              <td className="py-2 pr-3 text-right align-top tabular-nums text-zk-text2">{finding.days} d</td>
              {kind === "disclosed" ? (
                <td className="py-2 align-top text-xs text-zk-text2">
                  {finding.disclosedAt ? <LocalTime date={finding.disclosedAt} /> : null}
                  <span className="block">{finding.fixedLive ? "Fix live" : "Published early"}</span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const REPORT_BUTTON =
  "inline-flex h-10 items-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";

/** "Report a vulnerability": straight to the form in a one-project workspace, else pick the project. */
function ReportButton({ projects }: { projects: { name: string; ref: ProjectRef }[] }) {
  if (projects.length === 0) return null;
  if (projects.length === 1) {
    // A full page load, so the quick-report modal doesn't intercept it.
    return <a href={newIssuePath(projects[0].ref, "security=1")} className={REPORT_BUTTON}>Report a vulnerability</a>;
  }
  return (
    <details className="security-report relative">
      <summary className={`${REPORT_BUTTON} cursor-pointer list-none`}>Report a vulnerability</summary>
      <div className="absolute right-0 z-10 mt-2 w-64 rounded-2xl border border-zk-border bg-zk-surface p-2 shadow-lg">
        <p className="px-2 py-1 text-xs text-zk-muted">Which product is it in?</p>
        <ul>
          {projects.map((project) => (
            <li key={project.ref}>
              <a href={newIssuePath(project.ref, "security=1")} className="block rounded-xl px-2 py-1.5 text-sm text-zk-text hover:bg-zk-bg">
                {project.name}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
