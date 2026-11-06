import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { formatZ } from "@/lib/points/rules";
import { EARN_TASKS, zikiTaskPath } from "@/lib/earn/draft";
import { paidCount, taskStateFor } from "@/lib/earn/progress";
import { EARN_TASK_MINUTES, EARN_TASK_UI } from "@/lib/earn/task-ui";
import { earnState, requireEarnAgent } from "@/lib/earn/state";
import { agentsLink, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Marketing tasks" };

/** A status shows only once a task has been started; a task nobody has opened shows none. */
const STATUS = {
  paid: { label: "Paid", chip: "bg-zk-ok-bg text-zk-ok-fg" },
  "in-review": { label: "Ziki is checking", chip: "bg-zk-warn-bg text-zk-warn-fg" },
  "in-progress": { label: "In progress", chip: "bg-zk-info-bg text-zk-info-fg" },
} as const;

/**
 * Marketing (#earn-tasks, Mark's call of 5 Nov): the four tasks an earner can do, at their own URL. A header
 * with what they add up to, then one card per task with what it pays and about how long it takes. The tasks are
 * independent: every one is open, in any order. A task starts when it is opened, and only then shows a status.
 */
export default async function EarnTasksPage() {
  const user = await requireUser();
  // No agent connected, no tasks: connecting it comes first.
  await requireEarnAgent(user.id);
  const { rows } = await earnState(user.id);
  const paid = paidCount(rows);
  const total = EARN_TASKS.reduce((sum, task) => sum + task.pay, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Link href="/earn/home" className={`self-start text-sm ${agentsLink}`}>← What should it work on?</Link>
      <header className={`${agentsSurface} earn-rise relative flex flex-wrap items-center gap-5 overflow-hidden p-6 sm:p-8`}>
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-zk-tint/60" />
        <div className="relative min-w-0 flex-1 basis-72 space-y-2">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zk-text sm:text-4xl">Help people find Ziki</h1>
          <p className="max-w-xl text-sm leading-relaxed text-zk-text2">
            Four short tasks. Your agent does the heavy lifting, you check what it gives you and send it in. Do them in any order.
          </p>
        </div>
        <div className="relative flex gap-8 text-right">
          <div>
            <p className="text-3xl font-extrabold tabular-nums text-zk-ok-fg">{formatZ(total)}</p>
            <p className="text-xs text-zk-muted">to earn here</p>
          </div>
          <div>
            <p className="text-3xl font-extrabold tabular-nums text-zk-text">{paid}<span className="text-lg text-zk-muted">/{EARN_TASKS.length}</span></p>
            <p className="text-xs text-zk-muted">tasks paid</p>
          </div>
        </div>
      </header>

      <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
        {EARN_TASKS.map((task, index) => {
          const state = taskStateFor(rows, index);
          const sentBack = rows.find((row) => row.taskKey === task.id)?.status === "rejected";
          const status = sentBack ? { label: "Sent back", chip: "bg-zk-bad-bg text-zk-bad-fg" } : state === "open" ? null : STATUS[state];
          const ui = EARN_TASK_UI[task.id];
          const done = state === "paid" || state === "in-review";
          return (
            <li key={task.id} className="earn-rise" style={{ ["--i" as string]: index + 1 }}>
              <Link
                href={zikiTaskPath(index + 1)}
                className={`${agentsSurface} group flex h-full flex-col gap-4 p-5 transition hover:-translate-y-0.5 hover:border-electric-blue/50 hover:shadow-[0_14px_32px_rgba(11,23,51,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6`}
              >
                <div className="flex items-start gap-4">
                  <span aria-hidden="true" className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] ${ui.tint}`}>
                    {state === "paid" ? (
                      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ui.icon} /></svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-zk-muted">Task {index + 1} · about {EARN_TASK_MINUTES[task.id]} min</p>
                    <h2 className="mt-0.5 text-lg font-extrabold leading-snug tracking-tight text-zk-text">{task.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-zk-text2">{task.detail}</p>
                  </div>
                  <span className="shrink-0 text-xl font-extrabold tabular-nums text-zk-ok-fg">+{formatZ(task.pay)}</span>
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-zk-divider pt-4">
                  {status ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.chip}`}>{status.label}</span> : <span className="text-xs text-zk-muted">Open to start</span>}
                  <span
                    className={`inline-flex min-h-10 items-center rounded-full px-5 text-sm font-bold transition ${done ? "border border-zk-border bg-zk-surface text-zk-text group-hover:bg-zk-chip" : "bg-electric-blue-strong text-white group-hover:bg-[#2552af]"}`}
                  >
                    {state === "paid" ? "View" : state === "in-review" ? "View" : state === "in-progress" || sentBack ? "Continue" : "Start"} →
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="px-1 text-xs leading-relaxed text-zk-muted">
        {paid >= EARN_TASKS.length ? "All four done. " : ""}Open source comes after these. <Link href="/earn/open-source" className={agentsLink}>See it</Link>
      </p>
    </div>
  );
}
