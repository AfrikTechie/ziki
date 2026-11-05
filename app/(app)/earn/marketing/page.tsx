import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { formatZ } from "@/lib/points/rules";
import { EARN_TASKS, zikiTaskPath } from "@/lib/earn/draft";
import { paidCount, taskStateFor } from "@/lib/earn/progress";
import { EARN_TASK_UI } from "@/lib/earn/task-ui";
import { earnState, requireEarnAgent, startIfAgentConnected } from "@/lib/earn/state";
import { agentsLink } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Marketing tasks" };

const STATUS = {
  paid: { label: "Paid", chip: "bg-zk-ok-bg text-zk-ok-fg" },
  "in-review": { label: "Ziki is checking", chip: "bg-zk-warn-bg text-zk-warn-fg" },
  "in-progress": { label: "In progress", chip: "bg-zk-info-bg text-zk-info-fg" },
  open: { label: "Up next", chip: "bg-zk-info-bg text-zk-info-fg" },
  locked: { label: "Later", chip: "bg-zk-chip text-zk-muted" },
} as const;

/**
 * Marketing (#earn-tasks, Mark's call of 5 Nov): the tasks an earner sees after choosing Marketing on
 * /earn, at their own URL. All four are listed as short cards, each with what it pays and where it is;
 * the one you're on is the one with a button. Not the builders' issue list.
 */
export default async function EarnTasksPage() {
  const user = await requireUser();
  // No agent connected, no tasks: back to /earn to connect it first.
  await requireEarnAgent(user.id);
  // With an agent connected, the next task starts on its own, before the state is read.
  await startIfAgentConnected(user.id);
  const { rows } = await earnState(user.id);
  const paid = paidCount(rows);
  const total = EARN_TASKS.reduce((sum, task) => sum + task.pay, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Marketing</h1>
        <p className="text-sm text-zk-text2">Help people find Ziki. Earn up to <b className="text-zk-text">{formatZ(total)}</b> from {EARN_TASKS.length} short tasks.</p>
      </div>

      <ol className="m-0 grid list-none gap-4 p-0">
        {EARN_TASKS.map((task, index) => {
          const state = taskStateFor(rows, index);
          const sentBack = rows.find((row) => row.taskKey === task.id)?.status === "rejected";
          const status = sentBack ? { label: "Sent back", chip: "bg-zk-bad-bg text-zk-bad-fg" } : STATUS[state];
          const ui = EARN_TASK_UI[task.id];
          const current = index === paid && state !== "in-review";
          return (
            <li
              key={task.id}
              className={`flex flex-wrap items-center gap-4 rounded-[20px] border bg-zk-surface p-5 transition sm:p-6 ${current ? "border-electric-blue/50 shadow-[0_12px_30px_rgba(11,23,51,0.08)]" : "border-zk-border"} ${state === "locked" ? "opacity-70" : ""}`}
            >
              <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${ui.tint}`}>
                {state === "paid" ? (
                  <span className="text-xl font-extrabold">✓</span>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ui.icon} /></svg>
                )}
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <h2 className="text-lg font-extrabold leading-tight tracking-tight text-zk-text"><span className="sr-only">{index + 1}. </span>{task.title}</h2>
                <p className="text-sm text-zk-text2">{task.detail}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.chip}`}>{status.label}</span>
              <span className="w-12 text-right text-base font-extrabold tabular-nums text-zk-ok-fg">+{formatZ(task.pay)}</span>
              {state === "locked" ? null : current ? (
                <Link href={zikiTaskPath(index + 1)} className="inline-flex min-h-11 items-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2">
                  {state === "in-progress" ? "Continue" : "Start"}
                </Link>
              ) : (
                <Link href={zikiTaskPath(index + 1)} className={`text-sm ${agentsLink}`}>View</Link>
              )}
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
