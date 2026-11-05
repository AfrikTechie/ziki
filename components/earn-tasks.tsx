import Link from "next/link";
import { formatZ } from "@/lib/points/rules";
import { CONVERSION_BONUS, WITHDRAW_THRESHOLD, stageTasks, tasksDone, type EarnStage } from "@/lib/earn/draft";
import { agentsLink, agentsPrimaryBtn } from "@/app/(app)/settings/agents/agents-ui";

/**
 * Your tasks (#earn-drafts), on My agents: the tasks that pay, the next one
 * highlighted, and last the step that opens Withdraw. Once the tasks are
 * done, that last step becomes the next thing to do: follow up.
 */
export function EarnTasks({ stage }: { stage: EarnStage }) {
  const tasks = stageTasks(stage);
  const next = tasks.find((task) => !task.done);
  const done = tasks.filter((task) => task.done).length;
  const converted = stage === "unlocked";
  const followUp = !next && !converted;
  // What the closed list still says: the one thing to do next.
  const nextLine = next
    ? `Next: ${next.title} · +${formatZ(next.pay)}`
    : followUp
      ? `Next: follow up with Mama Ade's Bakery · +${formatZ(CONVERSION_BONUS)}`
      : "All done. Withdraw is open.";
  return (
    // Open by default; it can be closed so a long list doesn't push everything down, and the header still says what's next.
    <details id="earn-tasks" open className="group/tasks overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 bg-zk-tint px-4 py-3 group-open/tasks:border-b group-open/tasks:border-zk-border sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-zk-text">Your tasks</span>
          <span className="block text-xs text-zk-text2 group-open/tasks:hidden">{nextLine}</span>
        </span>
        <span className="flex items-center gap-3 text-xs font-semibold text-zk-muted">
          {done === 0 ? `${tasks.length} tasks to start` : `${done} of ${tasks.length} tasks done`}
          {tasksDone(stage) ? <Link href="/earn/people" className={agentsLink}>People you reached</Link> : null}
          <span className="inline-flex items-center gap-1 rounded-full border border-zk-border bg-zk-surface px-2.5 py-1 text-xs font-bold text-zk-text">
            <span className="group-open/tasks:hidden">Show all</span>
            <span className="hidden group-open/tasks:inline">Hide</span>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open/tasks:rotate-180" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </span>
      </summary>
      <ol className="m-0 list-none divide-y divide-zk-border p-0">
        {tasks.map((task, index) => {
          const current = !task.done;
          return (
            <li key={task.id} className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[2rem_minmax(0,1fr)_3.5rem_7rem] sm:px-6 ${current ? "bg-zk-tint/60" : ""}`}>
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  task.done ? "bg-zk-ok-bg text-zk-ok-fg" : current ? "bg-electric-blue-strong text-white" : "bg-zk-chip text-zk-muted"
                }`}
              >
                {task.done ? "✓" : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${task.done ? "text-zk-text2" : "text-zk-text"}`}>{task.title}</p>
                <p className="mt-0.5 text-xs text-zk-muted">{task.detail}</p>
              </div>
              <span className="text-right font-mono text-sm font-bold tabular-nums text-zk-ok-fg">+{formatZ(task.pay)}</span>
              <span className="col-span-3 flex justify-end sm:col-span-1">
                {task.done ? (
                  <span className="inline-flex items-center rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">Done</span>
                ) : (
                  current ? (
                    <Link href={`/earn/${task.id}`} aria-label={`Start: ${task.title}`} className={agentsPrimaryBtn}>Start</Link>
                  ) : null
                )}
              </span>
            </li>
          );
        })}
        <li className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[2rem_minmax(0,1fr)_3.5rem_7rem] sm:px-6 ${followUp ? "bg-zk-tint/60" : ""}`}>
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
              converted ? "bg-zk-ok-bg text-zk-ok-fg" : followUp ? "bg-electric-blue-strong text-white" : "bg-zk-chip text-zk-muted"
            }`}
          >
            {converted ? "✓" : tasks.length + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${converted ? "text-zk-text2" : "text-zk-text"}`}>Fix open-source issues</p>
            <p className="mt-0.5 text-xs text-zk-muted">
              {converted
                ? "Mama Ade's Bakery started a project. Withdraw is open."
                : followUp
                  ? "Mama Ade's Bakery signed up. A friendly follow-up often gets them started."
                  : `With your tasks done, this takes you to ${formatZ(WITHDRAW_THRESHOLD)}.`}
            </p>
          </div>
          <span className="text-right font-mono text-sm font-bold tabular-nums text-zk-ok-fg">+{formatZ(CONVERSION_BONUS)}</span>
          <span className="col-span-3 flex justify-end sm:col-span-1">
            {converted ? (
              <span className="inline-flex items-center rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">Done</span>
            ) : followUp ? (
              <Link href="/earn/people" className={agentsPrimaryBtn}>Follow up</Link>
            ) : (
              <span className="inline-flex items-center rounded-full bg-zk-chip px-2.5 py-0.5 text-xs font-bold text-zk-muted">Later</span>
            )}
          </span>
        </li>
      </ol>
    </details>
  );
}
