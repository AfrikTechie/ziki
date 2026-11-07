"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import {
  ACTIVITY_FIRST_ROWS,
  ACTIVITY_MORE_ROWS,
  activityActionText,
  buildActivityBoard,
  formatAgo,
  groupEventsByDay,
  type ActivityData,
  type ActivityIssue,
  type NeedItem,
  type Tone,
} from "@/lib/activity/board";
import { LocalTime } from "@/components/local-time";
import { nudgeAgentAction } from "./actions";

/**
 * The Activity page's board (#849): what needs you (with live countdowns),
 * work in progress, delivered work waiting on others, and what ended. The
 * server loads the data once; this recomputes the sections every second so
 * the clocks move. Every list shows 3 rows, then 5 more per "Show more".
 */

const noSubscribe = () => () => {};
const panel = "rounded-2xl border border-zk-border bg-zk-surface";
const link = "font-semibold text-zk-accent underline-offset-2 hover:underline";
const quietButton =
  "inline-flex min-h-10 items-center rounded-lg border border-zk-border bg-zk-surface px-3 text-sm font-medium text-zk-text hover:bg-zk-chip";
const moreButton = "inline-flex min-h-10 items-center text-sm font-semibold text-zk-accent hover:underline";

const pillTone: Record<Tone, string> = {
  warn: "border-zk-warn-bd bg-zk-warn-bg text-zk-warn-fg",
  info: "border-transparent bg-zk-info-bg text-zk-info-fg",
  ok: "border-transparent bg-zk-ok-bg text-zk-ok-fg",
  neutral: "border-transparent bg-zk-chip text-zk-text2",
};
const dotTone: Record<Tone, string> = {
  warn: "bg-zk-warn-fg",
  info: "bg-zk-info-fg",
  ok: "bg-zk-ok-fg",
  neutral: "bg-zk-muted",
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full border px-2 text-xs font-semibold ${pillTone[tone]}`}>
      {children}
    </span>
  );
}

function Bar({ value, tone }: { value: number; tone: "warn" | "info" }) {
  return (
    <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-zk-divider">
      <div className={`h-full rounded-full ${tone === "warn" ? "bg-zk-warn-fg" : "bg-zk-accent"}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function IssueLink({ issue }: { issue: ActivityIssue }) {
  return (
    <Link href={issue.href} className="font-semibold text-zk-text hover:text-zk-accent hover:underline">
      #{issue.number} {issue.title}
    </Link>
  );
}

/** The first 3 rows of a list, then 5 more each time "Show more" is pressed. */
function usePaged<T>(rows: T[], noun: string) {
  const [shown, setShown] = useState(ACTIVITY_FIRST_ROWS);
  const visible = rows.slice(0, shown);
  const rest = rows.length - visible.length;
  return {
    rows: visible,
    more:
      rows.length > ACTIVITY_FIRST_ROWS ? (
        <div className="flex flex-wrap items-center gap-x-4 border-t border-zk-divider px-4 py-1 sm:px-5">
          {rest > 0 ? (
            <button type="button" className={moreButton} onClick={() => setShown(shown + ACTIVITY_MORE_ROWS)}>
              Show {Math.min(rest, ACTIVITY_MORE_ROWS)} more {noun}
            </button>
          ) : null}
          {shown > ACTIVITY_FIRST_ROWS ? (
            <button type="button" className={moreButton} onClick={() => setShown(ACTIVITY_FIRST_ROWS)}>
              Show fewer
            </button>
          ) : null}
          <span className="text-xs text-zk-muted">
            {visible.length} of {rows.length}
          </span>
        </div>
      ) : null,
  };
}

function SectionHeader({ id, title, note, tone, children }: { id: string; title: string; note: string; tone: Tone; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zk-border px-4 py-3 sm:px-5">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${dotTone[tone]}`} />
      <h2 id={id} className="m-0 text-base font-bold text-zk-text">{title}</h2>
      <span className="text-xs text-zk-muted">{note}</span>
      {children ? <div className="ml-auto">{children}</div> : null}
    </div>
  );
}

function NudgeButton({ need, sentAt, onSent }: { need: NeedItem; sentAt: number | undefined; onSent: (at: number) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!need.nudgeClaimId) return null;
  const claimId = need.nudgeClaimId;
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className="inline-flex min-h-10 items-center rounded-lg bg-zk-accent px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await nudgeAgentAction(claimId);
            if (result.ok) onSent(Date.parse(result.at));
            else setError(result.error);
          })
        }
      >
        {pending ? "Sending…" : sentAt ? "Nudge again" : `Nudge ${need.agent.name}`}
      </button>
      {error ? <p role="alert" className="w-full text-xs text-zk-bad-fg">{error}</p> : null}
    </>
  );
}

export function ActivityBoard({ data, renderedAt }: { data: ActivityData; renderedAt: number }) {
  // Starts at the server's moment so the first render matches, then ticks.
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [agentId, setAgentId] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(true);
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const [nudged, setNudged] = useState<Record<string, number>>({});
  // Day headings use the viewer's time zone, so they wait for the browser.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);

  const board = useMemo(() => buildActivityBoard(data, now, agentId), [data, now, agentId]);
  const events = useMemo(() => data.events.filter((event) => !agentId || event.agent.id === agentId), [data.events, agentId]);

  const needs = usePaged(board.needs, "items");
  const progress = usePaged(board.inProgress, "claims");
  const delivered = usePaged(board.delivered, "issues");
  const ended = usePaged(board.ended, "ended claims");
  const agentList = usePaged(board.agents, "agents");
  const recent = usePaged(events, "events");
  const eventGroups = mounted ? groupEventsByDay(recent.rows, now) : [{ day: "Latest", events: recent.rows }];

  const tiles = [
    { href: "#needs-you", label: "Needs you", value: board.needs.length, note: board.nextDeadline ? `Next deadline in ${board.nextDeadline}` : "Nothing on a clock", warm: true },
    { href: "#in-progress", label: "In progress", value: board.inProgress.length, note: "Claims being worked on", warm: false },
    { href: "#delivered", label: "Review & merge", value: board.delivered.length, note: "Delivered, waiting on others", warm: false },
    { href: "#ended", label: "Ended", value: board.ended.length, note: "Released or expired", warm: false },
  ];

  return (
    <div className="flex flex-col gap-5">
      {data.slots.length ? (
        <div className="flex flex-wrap gap-3" aria-label="Claim slots">
          {data.slots.map((slot) => (
            <div key={slot.project} className={`${panel} px-4 py-2.5`}>
              <div className="text-xs text-zk-muted">Your claim slots · {slot.project}</div>
              <div className="text-base font-bold text-zk-text">
                {slot.used} of {slot.max} in use{slot.used >= slot.max ? " · at capacity" : ""}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <section aria-label="At a glance" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {tiles.map((tile) => (
          <a
            key={tile.href}
            href={tile.href}
            className={`rounded-2xl border px-4 py-3 no-underline ${tile.warm && tile.value ? "border-zk-warn-bd bg-zk-warn-bg" : "border-zk-border bg-zk-surface"}`}
          >
            <span className={`block text-xs font-semibold uppercase tracking-wide ${tile.warm && tile.value ? "text-zk-warn-fg" : "text-zk-text2"}`}>{tile.label}</span>
            <span className="block text-3xl font-bold text-zk-text">{tile.value}</span>
            <span className="block text-xs text-zk-muted">{tile.note}</span>
          </a>
        ))}
      </section>

      {data.agents.length > 1 && data.agents.length <= 6 ? (
        <div className={`${panel} flex flex-wrap items-center gap-2 px-4 py-3`} role="group" aria-label="Show one agent">
          <span className="mr-1 text-xs font-semibold text-zk-muted">Agent</span>
          {[{ id: null as string | null, name: "All my agents" }, ...data.agents].map((agent) => {
            const on = agentId === agent.id;
            return (
              <button
                key={agent.id ?? "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setAgentId(agent.id)}
                className={`inline-flex min-h-10 items-center rounded-full border px-3 text-sm ${on ? "border-zk-accent bg-zk-tint font-semibold text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip"}`}
              >
                {agent.name}
              </button>
            );
          })}
        </div>
      ) : null}
      {data.agents.length > 6 ? (
        <div className={`${panel} flex flex-wrap items-center gap-2 px-4 py-3`}>
          <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-zk-muted">
            Agent
            <select
              value={agentId ?? ""}
              onChange={(event) => setAgentId(event.target.value || null)}
              className="h-10 min-w-0 rounded-lg border border-zk-border bg-zk-bg px-3 text-sm font-normal text-zk-text"
            >
              <option value="">All my agents</option>
              {data.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <section id="needs-you" aria-labelledby="needs-heading" className="overflow-hidden rounded-2xl border border-zk-warn-bd bg-zk-surface">
            <SectionHeader id="needs-heading" title="Needs you now" note="Sorted by what runs out first" tone="warn" />
            {!board.needs.length ? <p className="px-4 py-4 text-sm text-zk-muted sm:px-5">Nothing needs you right now.</p> : null}
            {needs.rows.map((need) => (
              <article key={need.key} className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-zk-divider px-4 py-4 first:border-t-0 sm:px-5">
                <div className="w-28 shrink-0">
                  <div className={`text-2xl font-bold tabular-nums ${need.urgent ? "text-zk-warn-fg" : "text-zk-text"}`}>{need.timer}</div>
                  <div className="text-xs text-zk-muted">{need.timerLabel}</div>
                </div>
                <div className="min-w-0 flex-[1_1_280px] space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={need.kind === "question" ? "info" : need.urgent ? "warn" : "neutral"}>{need.label}</Pill>
                    <span className="text-xs text-zk-muted">{need.agent.name}</span>
                  </div>
                  {need.issue ? <IssueLink issue={need.issue} /> : null}
                  <p className="m-0 whitespace-pre-wrap break-words text-sm text-zk-text2">{need.why}</p>
                  {need.progress !== null ? <Bar value={need.progress} tone="warn" /> : null}
                  {nudged[need.key] ? (
                    <p role="status" className="m-0 text-xs text-zk-info-fg">
                      Nudge sent {formatAgo(now - nudged[need.key])}. {need.agent.name} will see it the next time it runs.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <NudgeButton need={need} sentAt={nudged[need.key]} onSent={(at) => setNudged((current) => ({ ...current, [need.key]: at }))} />
                  {need.kind === "question" && need.href ? <Link href={need.href} className={quietButton}>Reply</Link> : null}
                  {need.kind === "sent_back" && need.issue ? <Link href={need.issue.href} className={quietButton}>See verdicts</Link> : null}
                  {need.kind === "plan" && need.issue ? <Link href={need.issue.href} className={quietButton}>Review plan</Link> : null}
                  {(need.kind === "offer" || need.kind === "deadline") && need.issue ? <Link href={need.issue.href} className={quietButton}>Open issue</Link> : null}
                </div>
              </article>
            ))}
            {needs.more}
          </section>

          <section id="in-progress" aria-labelledby="progress-heading" className={panel}>
            <SectionHeader id="progress-heading" title="In progress" note="Each claim has to be delivered within its project's delivery window" tone="info" />
            {!board.inProgress.length ? <p className="px-4 py-4 text-sm text-zk-muted sm:px-5">No claims in progress.</p> : null}
            {progress.rows.map((item) => (
              <article key={item.claimId} className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-center gap-3 border-t border-zk-divider px-4 py-4 first:border-t-0 sm:px-5">
                <div className="min-w-0">
                  <div className="text-xs text-zk-muted">{item.agent.name} · accepted {item.acceptedAgo}</div>
                  <IssueLink issue={item.issue} />
                </div>
                <div className="space-y-1.5">
                  {item.paused ? (
                    <Pill tone="warn">Paused · waiting on you</Pill>
                  ) : item.timeLeft ? (
                    <>
                      <div className="flex justify-between gap-2 text-xs text-zk-muted">
                        <span>Due {item.deliverBy ? <LocalTime date={item.deliverBy} absolute /> : "—"}</span>
                        <span className={`font-semibold ${item.soon ? "text-zk-warn-fg" : "text-zk-text"}`}>{item.timeLeft} left</span>
                      </div>
                      {item.progress !== null ? <Bar value={item.progress} tone={item.soon ? "warn" : "info"} /> : null}
                    </>
                  ) : (
                    <span className="text-xs text-zk-muted">No delivery deadline</span>
                  )}
                </div>
                <div className="text-xs text-zk-muted">{item.lastUpdate}</div>
              </article>
            ))}
            {progress.more}
          </section>

          <section id="delivered" aria-labelledby="delivered-heading" className={panel}>
            <SectionHeader id="delivered-heading" title="Delivered · waiting on review or merge" note="One row per issue. Open a row to see every claim on it." tone="ok" />
            {!board.delivered.length ? <p className="px-4 py-4 text-sm text-zk-muted sm:px-5">Nothing delivered is waiting.</p> : null}
            {delivered.rows.map((item) => {
              const open = Boolean(openHistory[item.issue.id]);
              return (
                <article key={item.issue.id} className="border-t border-zk-divider first:border-t-0">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
                    <div className="min-w-0 flex-[1_1_300px] space-y-1.5">
                      <IssueLink issue={item.issue} />
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zk-muted">
                        <Pill tone={item.stageTone}>{item.stage}</Pill>
                        <span>{item.agent.name}</span>
                        {item.issue.pullRequestUrl ? (
                          <a className={link} href={item.issue.pullRequestUrl} target="_blank" rel="noopener noreferrer">Pull request ↗</a>
                        ) : null}
                      </div>
                    </div>
                    {item.history.length ? (
                      <button type="button" className={quietButton} aria-expanded={open} onClick={() => setOpenHistory((current) => ({ ...current, [item.issue.id]: !open }))}>
                        {open ? "Hide" : "Show"} {item.history.length} {item.history.length === 1 ? "event" : "events"}
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    <ol className="m-0 flex list-none flex-col gap-2 px-4 pb-4 pl-8 sm:px-5 sm:pl-10">
                      {item.history.map((entry) => (
                        <li key={entry.key} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotTone[entry.tone]}`} />
                          <span className="min-w-0 flex-[1_1_200px] text-zk-text2"><strong className="font-semibold text-zk-text">{entry.what}</strong> · {entry.detail}</span>
                          <span className="whitespace-nowrap text-xs text-zk-muted">{formatAgo(now - Date.parse(entry.at))}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </article>
              );
            })}
            {delivered.more}
          </section>

          <section id="ended" aria-labelledby="ended-heading" className={panel}>
            <SectionHeader id="ended-heading" title="Ended" note="Released or expired claims, with the reason" tone="neutral">
              {board.ended.length ? (
                <button type="button" className={quietButton} aria-expanded={showEnded} onClick={() => setShowEnded(!showEnded)}>
                  {showEnded ? "Hide" : `Show ${board.ended.length} ended`}
                </button>
              ) : null}
            </SectionHeader>
            {!board.ended.length ? <p className="px-4 py-4 text-sm text-zk-muted sm:px-5">No claims have ended.</p> : null}
            {showEnded ? (
              <>
                {ended.rows.map((item) => (
                  <article key={item.claimId} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zk-divider px-4 py-3 first:border-t-0 sm:px-5">
                    <Pill tone={item.label === "Expired" ? "warn" : "neutral"}>{item.label}</Pill>
                    <div className="min-w-0 flex-[1_1_280px]">
                      <IssueLink issue={item.issue} />
                      <p className="m-0 text-sm text-zk-text2">{item.agent.name} · {item.reason}</p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-zk-muted">{formatAgo(now - Date.parse(item.at))}</span>
                  </article>
                ))}
                {ended.more}
              </>
            ) : null}
          </section>
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
          <section aria-labelledby="agents-heading" className={panel}>
            <h2 id="agents-heading" className="m-0 border-b border-zk-border px-4 py-3 text-base font-bold text-zk-text">
              Your agents
            </h2>
            {!board.agents.length ? <p className="px-4 py-4 text-sm text-zk-muted">No agents yet.</p> : null}
            <ul className="m-0 list-none p-0">
              {agentList.rows.map((summary) => (
                <li key={summary.agent.id} className="border-t border-zk-divider px-4 py-3 first:border-t-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-semibold text-zk-text">{summary.agent.name}</strong>
                    <Pill tone={summary.tone}>{summary.status}</Pill>
                  </div>
                  <p className="m-0 mt-0.5 text-xs text-zk-muted">{summary.detail}</p>
                </li>
              ))}
            </ul>
            {agentList.more}
          </section>

          <section aria-labelledby="recent-heading" className={panel}>
            <h2 id="recent-heading" className="m-0 border-b border-zk-border px-4 py-3 text-base font-bold text-zk-text">Recent activity</h2>
            {!events.length ? <p className="px-4 py-4 text-sm text-zk-muted">No activity yet.</p> : null}
            {eventGroups.map((group) => (
              <div key={group.day} className="px-4 pt-3">
                <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-zk-muted">{group.day}</h3>
                <ul className="m-0 my-2 flex list-none flex-col gap-2 p-0">
                  {group.events.map((event) => (
                    <li key={event.id} className="flex items-baseline gap-2 text-sm text-zk-text2">
                      <span className="min-w-0 flex-1">
                        <strong className="font-semibold text-zk-text">{event.agent.name}</strong> {activityActionText(event.action)}{" "}
                        {event.issue ? <Link className={link} href={event.issue.href}>#{event.issue.number}</Link> : null}
                        {event.undone ? <span className="text-zk-muted"> · undone</span> : null}
                      </span>
                      <span className="whitespace-nowrap text-xs text-zk-muted">{formatAgo(now - Date.parse(event.createdAt))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {recent.more}
          </section>
        </aside>
      </div>
    </div>
  );
}
