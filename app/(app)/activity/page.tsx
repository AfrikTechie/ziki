import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { loadAgentCenter } from "@/lib/agent-center/queries";
import { activityFilters, activityHref, type ActivityParams, type ActivityStream } from "@/lib/agent-center/paging";
import { parseEscalationBody } from "@/lib/agent-questions";
import { statusLabel } from "@/lib/labels";
import { issueHref } from "@/lib/issue-ref";
import { LocalTime } from "@/components/local-time";
import { EscalationTypeBadge, QuickResolveButtons } from "@/app/(app)/inbox/escalation-controls";

export const metadata = { title: "Human–Agent Activity" };
const panel = "space-y-4 rounded-2xl border border-zk-border bg-zk-surface p-4 sm:p-6";
const link = "font-semibold text-zk-accent underline-offset-2 hover:underline";

function IssueLinks({ bug }: { bug: { id: string; number: number; title: string; pullRequestUrl: string | null; project: { slug: string; tenant: { slug: string } } } | null }) {
  if (!bug) return <p className="text-sm text-zk-muted">No linked issue</p>;
  return <div className="flex flex-wrap gap-3 text-sm">
    <Link className={link} href={issueHref(bug)}>#{bug.number} {bug.title}</Link>
    {bug.pullRequestUrl ? <a className={link} href={bug.pullRequestUrl} target="_blank" rel="noopener noreferrer">Pull request ↗</a> : null}
  </div>;
}

function Pages({ params, stream, next }: { params: ActivityParams; stream: ActivityStream; next: string | null }) {
  return <nav aria-label={`${stream} pages`} className="flex gap-4 text-sm">
    {params[stream] ? <Link className={link} href={activityHref(params, stream, null)}>Newest</Link> : null}
    {next ? <Link className={link} href={activityHref(params, stream, next)}>Older</Link> : null}
  </nav>;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<ActivityParams> }) {
  const user = await requireUser();
  if (!isAgentPlatformEnabled()) return <p>The agent platform is not enabled in this environment.</p>;
  const params = await searchParams;
  const data = await loadAgentCenter(user.id, await currentTenantIdFor(user.id), params);
  if (!data) return <div className={panel}><h1 className="text-2xl font-bold">Activity</h1><p>Join a workspace to view agent activity.</p><Link className={link} href="/tenants">Workspaces</Link></div>;
  const filters = activityFilters(params);

  return <div className="mx-auto max-w-5xl space-y-6 text-zk-text">
    <header className="space-y-2">
      <h1 className="text-2xl font-extrabold">Human–Agent Activity</h1>
      <p className="text-sm text-zk-text2">{data.isAdmin ? "Workspace work and activity. Private escalations are limited to your own requests." : "Your agents’ work, requests and activity in this workspace."}</p>
    </header>
    <form method="get" className={`${panel} flex flex-wrap items-end gap-3`}>
      <label className="text-sm">Issue number<input name="issue" defaultValue={filters.issue} placeholder="123" className="mt-1 block rounded-lg border border-zk-border bg-zk-bg px-3 py-2" /></label>
      <label className="text-sm">Claim state<select name="state" defaultValue={filters.state} className="mt-1 block rounded-lg border border-zk-border bg-zk-bg px-3 py-2">
        <option value="all">All claims</option><option value="active">Active</option><option value="offered">Offered</option><option value="released">Released</option>
      </select></label>
      <button className="rounded-full bg-electric-blue-strong px-4 py-2 font-semibold text-white" type="submit">Filter</button>
      <Link className={link} href="/activity">Clear filters</Link>
      <p className="w-full text-xs text-zk-muted">Issue number filters every section. Claim state filters Work History only. Each list shows up to 20 records.</p>
    </form>

    <section className={panel} aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="text-xl font-bold">Needs Attention</h2>
      <div id="questions" className="space-y-3">
        <h3 className="font-bold">Your escalation responses</h3>
        <p className="text-sm text-zk-text2">Replies guide your agent and can resume a paused claim.</p>
        {!data.questions.items.length ? <p className="text-sm text-zk-muted">No unanswered escalations on this page.</p> : null}
        {data.questions.items.map((question) => {
          const parsed = parseEscalationBody(question.body);
          return <article key={question.id} className={panel}>
            <div className="flex flex-wrap items-center gap-2"><EscalationTypeBadge type={parsed.type} /><span className="font-semibold">{question.agent.name}</span><LocalTime date={question.createdAt} /></div>
            <p className="whitespace-pre-wrap break-words text-sm">{parsed.cleanBody}</p>
            <IssueLinks bug={question.bug} />
            <QuickResolveButtons escalationId={question.id} />
            <Link className={link} href={`/inbox/escalations/${question.id}`}>Write a response or decline</Link>
          </article>;
        })}
        <Pages params={params} stream="questions" next={data.questions.next} />
      </div>
    </section>

    <section id="work" className={panel} aria-labelledby="work-heading">
      <h2 id="work-heading" className="text-xl font-bold">Work History</h2>
      {!data.work.items.length ? <p className="text-sm text-zk-muted">No claims on this page.</p> : null}
      {data.work.items.map((claim) => <article key={claim.id} className="space-y-2 border-t border-zk-border pt-3 text-sm">
        <p><strong>{claim.agent.name}</strong> · Claim: {claim.status} · Issue: {statusLabel[claim.bug.status]}</p>
        <IssueLinks bug={claim.bug} />
        <p>Recorded <LocalTime date={claim.createdAt} /></p>
        {claim.waitingOnOwnerSince && !claim.releasedAt ? <p className="text-zk-warn-fg">Blocked: waiting for owner guidance, asked <LocalTime date={claim.waitingOnOwnerSince} />. Claim clocks are paused.</p> : null}
        {claim.deliverBy ? <p>{claim.bug.pullRequestUrl || claim.releasedAt ? "Recorded deadline" : "Delivery deadline"}: <LocalTime date={claim.deliverBy} /></p> : null}
        {claim.lastHeartbeatAt ? <p>Last heartbeat: <LocalTime date={claim.lastHeartbeatAt} /></p> : null}
        {claim.releaseReason ? <p>Release reason: {claim.releaseReason}</p> : null}
      </article>)}
      <Pages params={params} stream="work" next={data.work.next} />
    </section>

    <section id="events" className={panel} aria-labelledby="events-heading">
      <h2 id="events-heading" className="text-xl font-bold">Recent Activity</h2>
      <p className="text-sm text-zk-text2">Agent audit summaries, newest first. Supplementary request rows are hidden. Audit retention is 180 days.</p>
      {!data.events.items.length ? <p className="text-sm text-zk-muted">No activity on this page.</p> : null}
      {data.events.items.map((event) => <article key={event.id} className="space-y-2 border-t border-zk-border pt-3 text-sm">
        <p><strong>{event.agent.name}</strong> · {event.action} · <LocalTime date={event.createdAt} />{event.undoneAt ? " · Undone" : ""}</p>
        <IssueLinks bug={event.bug} />
      </article>)}
      <Pages params={params} stream="events" next={data.events.next} />
    </section>
  </div>;
}
