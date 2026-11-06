import Link from "next/link";
import { SIGNUP_BONUS, stageTasks, zikiTaskPath, type EarnStage, type EarnTaskId } from "@/lib/earn/draft";

/**
 * The Ziki tasks list (#earn-drafts, Mark's review): in the main list's own
 * table style (Reward, Task, Status). All four tasks are open at once: each one that
 * isn't paid has Start, and each row opens the task's own page.
 */
export function ZikiTasksTable({ stage, done }: { stage: EarnStage; /** The tasks that are paid, from the person's own confirmed tasks. */ done?: readonly EarnTaskId[] }) {
  const tasks = stageTasks(stage, done);
  return (
    <section aria-labelledby="ziki-tasks-heading" className="overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
      <h2 id="ziki-tasks-heading" className="sr-only">Ziki tasks</h2>
      <p className="border-b border-zk-border bg-zk-ok-bg/60 px-4 py-2.5 text-xs text-zk-ok-fg sm:px-6">
        <span className="font-bold">Ziki tasks</span> show here only while there is marketing work to do for Ziki. When there are none left, this step goes away. New ones are added here.
      </p>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_8rem] items-center gap-4 border-b border-zk-border bg-zk-bg/60 px-4 py-3 text-sm text-zk-muted sm:px-6">
        <span className="text-center">Reward</span>
        <span>Task</span>
        <span className="text-right">Status</span>
      </div>
      <ol className="m-0 list-none divide-y divide-zk-border p-0">
        {/* The first row is money she already has: the sign-up gift, paid before any task. */}
        {SIGNUP_BONUS > 0 ? (
          <li className="relative grid grid-cols-[4.5rem_minmax(0,1fr)_8rem] items-center gap-4 px-4 py-4 sm:px-6">
            <span className="text-center font-mono text-base font-bold tabular-nums text-zk-muted">${SIGNUP_BONUS}</span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-zk-text">You signed up for Ziki</p>
              <p className="mt-0.5 text-xs text-zk-muted">Your welcome gift. It is already in your balance.</p>
            </div>
            <span className="flex justify-end"><span className="inline-flex items-center rounded-full bg-zk-ok-bg px-3 py-1.5 text-xs font-bold text-zk-ok-fg">Paid</span></span>
          </li>
        ) : null}
        {tasks.map((task, i) => {
          return (
            <li key={task.id} className="relative grid grid-cols-[4.5rem_minmax(0,1fr)_8rem] items-center gap-4 px-4 py-4 hover:bg-zk-chip/50 sm:px-6">
              <span className={`text-center font-mono text-base font-bold tabular-nums ${task.done ? "text-zk-muted" : "text-zk-ok-fg"}`}>${task.pay}</span>
              <div className="min-w-0">
                {/* The title's link covers the row, so a click anywhere opens the task's page. */}
                <Link href={zikiTaskPath(i + 1)} className="block text-[15px] font-semibold text-zk-text after:absolute after:inset-0 after:content-[''] hover:text-zk-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-electric-blue">
                  {task.title}
                </Link>
                <p className="mt-0.5 text-xs text-zk-muted">
                  <span className="mr-2 font-semibold">Task {i + 1} of {tasks.length}</span>
                  {task.detail}
                </p>
              </div>
              <span className="relative z-10 flex justify-end">
                {task.done ? (
                  <span className="inline-flex items-center rounded-full bg-zk-ok-bg px-3 py-1.5 text-xs font-bold text-zk-ok-fg">Paid</span>
                ) : (
                  <Link href={zikiTaskPath(i + 1)} aria-label={`Start: ${task.title}`} className="inline-flex min-h-10 items-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2">
                    Start
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
