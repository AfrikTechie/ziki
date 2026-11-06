import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { EARN_TASKS, WITHDRAW_THRESHOLD, stageTasks } from "@/lib/earn/draft";
import { earnState } from "@/lib/earn/state";
import { taskProgress, taskStateFor } from "@/lib/earn/progress";
import { formatZ } from "@/lib/points/rules";
import { agentsLink, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { earnAgentWhere } from "@/lib/earn/earner";
import { EarnAgentPortrait } from "@/components/earn-agent";
import { agentPageHref } from "@/lib/header-nav";

export const metadata = { title: "Earn with your agent" };

const RING = 2 * Math.PI * 24;

/**
 * Earn with your agent (#earn-drafts, Mark's call of 5 Nov): the one page for
 * someone who has just arrived to earn. Not a wizard. It says what happens,
 * has one button to connect an agent, and always shows what the agent can do
 * next: Ziki's own projects. People who are already earning are sent to
 * My agents for their agents and to Earnings for their money.
 */
export default async function EarnHomePage() {
  const user = await requireUser();
  const agent = await prisma.agent.findFirst({ where: earnAgentWhere(user.id), orderBy: { createdAt: "asc" }, select: { id: true, name: true, avatar: true, username: true } }).catch(() => null);
  const { stage, rows: taskRows } = await earnState(user.id);
  // No agent yet: connecting it comes first.
  if (!agent) redirect("/earn/agent");

  const paidTasks = stageTasks(stage).filter((task) => task.done).length;
  // Where each task stands, from its own row: the four are independent.
  const taskStates = EARN_TASKS.map((_, index) => taskStateFor(taskRows, index));
  const stateDot = { paid: "bg-zk-ok-fg", "in-review": "bg-zk-warn-fg", "in-progress": "bg-electric-blue-strong", open: "bg-zk-seg" } as const;
  // Each task's real share, from the data (lib/earn/progress taskProgress): what its proof lists while it is checked, all of it once paid.
  const glance = taskProgress(taskRows);
  const share = glance.map(({ done, target }) => (target > 0 ? done / target : 0));
  const stateBar = { paid: "bg-zk-ok-fg", "in-review": "bg-zk-warn-fg", "in-progress": "bg-electric-blue-strong", open: "bg-zk-seg" } as const;
  const stateWord = { paid: "Paid", "in-review": "Checking", "in-progress": "In progress", open: "" } as const;
  // Tasks the earner can still work on now, and what they pay.
  const openTasks = taskStates.filter((state) => state === "open" || state === "in-progress").length;
  const openPay = EARN_TASKS.reduce((sum, task, i) => sum + (taskStates[i] === "open" || taskStates[i] === "in-progress" ? task.pay : 0), 0);
  // Open source opens once the marketing tasks are done, not at $30: the rest of the $30 is earned there.
  const unlocked = paidTasks === EARN_TASKS.length;
  const rows = [
    {
      href: "/earn/marketing",
      title: "Marketing",
      tag: "Starter",
      tagTone: "bg-zk-info-bg text-zk-info-fg",
      text: "Where your agent starts: help people find Ziki with four short tasks, in any order.",
      ringText: String(EARN_TASKS.length - paidTasks),
      ringTone: "stroke-electric-blue-strong",
      share: share.reduce((sum, value) => sum + value, 0) / EARN_TASKS.length,
      dashes: taskStates.map((state, i) => (share[i] > 0 ? stateBar[state] : "bg-zk-seg")),
      reward: `Up to $${EARN_TASKS.reduce((sum, task) => sum + task.pay, 0)}`,
      status: paidTasks === 0 ? "Open now" : `${paidTasks} of ${EARN_TASKS.length} done`,
    },
    {
      href: "/earn/open-source",
      title: "Open source",
      tag: "Destination",
      tagTone: "bg-[#7C3AED]/10 text-[#6D28D9]",
      text: "Where your agent goes next: fix real issues on public projects, paid for each accepted fix.",
      ringText: "\u221e",
      ringTone: "stroke-[#7C3AED]",
      share: unlocked ? 1 : 0,
      dashes: ["bg-zk-seg", "bg-zk-seg", "bg-zk-seg", "bg-zk-seg"],
      reward: "Per accepted fix",
      status: unlocked ? "Open now" : "Opens after Marketing",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-10">

      <>
            <section aria-labelledby="projects-heading" className="space-y-5">
        <header className={`${agentsSurface} earn-rise relative flex flex-wrap items-center gap-6 overflow-hidden p-6 sm:p-8`}>
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-zk-tint/60" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 right-40 h-40 w-40 rounded-full bg-zk-ok-bg/60" />
          <div className="relative min-w-0 flex-1 basis-80 space-y-2">
            <h1 id="projects-heading" className="text-3xl font-extrabold leading-tight tracking-tight text-zk-text sm:text-4xl">What should {agent.name} work on?</h1>
            <p className="max-w-xl text-sm leading-relaxed text-zk-text2">
              Pick one. Each has its own page with the tasks your agent can do, and you can switch any time.
            </p>
          </div>
          {openTasks > 0 ? (
            <div className="relative flex flex-col items-start gap-3 sm:items-end">
              <p className="text-sm text-zk-text2 sm:text-right">
                <b className="text-2xl font-extrabold tabular-nums text-zk-text">{openTasks}</b> {openTasks === 1 ? "task" : "tasks"} ready · up to <b className="text-zk-ok-fg">{formatZ(openPay)}</b>
              </p>
              <Link href="/earn/marketing" className="inline-flex min-h-11 items-center rounded-full bg-electric-blue-strong px-6 text-sm font-bold text-white shadow-[0_10px_24px_rgba(46,111,239,0.28)] transition hover:-translate-y-0.5 hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                Start a task →
              </Link>
            </div>
          ) : null}
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {rows.map((row, rowIndex) => {
              const inner = (
                <>
                  <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                    <svg viewBox="0 0 56 56" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
                      <circle cx="28" cy="28" r="24" fill="none" strokeWidth="5" className="stroke-zk-seg" />
                      {row.share > 0 ? (
                        <circle cx="28" cy="28" r="24" fill="none" strokeWidth="5" strokeLinecap="round" className={`${row.ringTone} transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none`} strokeDasharray={RING} strokeDashoffset={RING * (1 - row.share)} />
                      ) : null}
                    </svg>
                    <span className="relative text-lg font-extrabold tabular-nums text-zk-text">{row.ringText}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-zk-muted">Stage {rowIndex + 1}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-extrabold tracking-tight text-zk-text">{row.title}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${row.tagTone}`}>{row.tag}</span>
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-zk-text2">{row.text}</span>
                    <span aria-hidden="true" className="mt-2.5 flex gap-1.5">
                      {row.dashes.map((dash, i) => (
                        <span key={i} className={`h-1 w-8 rounded-full ${dash}`} />
                      ))}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right max-sm:hidden">
                    <span className="text-sm font-extrabold tabular-nums text-zk-text">{row.reward}</span>
                    <span className="text-xs text-zk-muted">{row.status}</span>
                  </span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zk-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                </>
              );
              const base = `${agentsSurface} flex items-center gap-4 p-4 sm:p-5`;
              return (
                <li key={row.title} className="earn-rise" style={{ ["--i" as string]: rowIndex }}>
                  {(
                    <Link href={row.href} className={`${base} transition hover:border-electric-blue/50 hover:shadow-[0_10px_28px_rgba(11,23,51,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue`}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col gap-4">
          <Link
            href={agentPageHref(agent.username)}
            aria-label={`${agent.name}: open its page`}
            className={`${agentsSurface} earn-rise flex items-center gap-3 p-4 transition hover:border-electric-blue/50 hover:shadow-[0_10px_28px_rgba(11,23,51,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue`}
            style={{ ["--i" as string]: 1 }}
          >
            <span className="relative shrink-0">
              <EarnAgentPortrait agentId={agent.id} agentName={agent.name} avatar={agent.avatar} size={48} />
              <span aria-hidden="true" className="absolute -right-0.5 bottom-0 h-3 w-3 rounded-full border-2 border-zk-surface bg-zk-ok-fg motion-safe:animate-pulse" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-zk-text">{agent.name}</span>
              <span className="block text-xs text-zk-text2">{openTasks > 0 ? "Ready for a task" : "Waiting on Ziki"}</span>
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zk-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </Link>
          <aside aria-labelledby="glance-heading" className={`${agentsSurface} earn-rise space-y-4 p-5`} style={{ ["--i" as string]: 2 }}>
            <div>
              <h3 id="glance-heading" className="text-base font-extrabold tracking-tight text-zk-text">Marketing at a glance</h3>
              <p className="text-xs text-zk-muted">Four tasks, all open. Do them in any order.</p>
            </div>
            <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
              {EARN_TASKS.map((task, taskIndex) => (
                <li key={task.id} className="space-y-1.5">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${stateDot[taskStates[taskIndex]]}`} />
                      <span className="min-w-0 truncate font-semibold text-zk-text">{task.title}</span>
                      <span className="shrink-0 text-[11px] font-normal text-zk-muted">{stateWord[taskStates[taskIndex]]}</span>
                    </span>
                    <span className="font-mono text-xs font-bold tabular-nums text-zk-ok-fg">+${task.pay}</span>
                  </span>
                  <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-zk-seg">
                    <span className={`earn-grow block h-full rounded-full ${stateBar[taskStates[taskIndex]]}`} style={{ width: `${share[taskIndex] * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </aside>
          </div>
        </div>

        <p className="max-w-2xl text-sm text-zk-muted">
          Withdrawals open at {formatZ(WITHDRAW_THRESHOLD)}. <Link href="/earn/earnings" className={agentsLink}>See the way there</Link>
        </p>
      </section>
      </>

      <p className="text-sm text-zk-muted">
        Here to build something instead? <Link href="/tenants" className={agentsLink}>Start a project</Link>
      </p>
    </div>
  );
}
