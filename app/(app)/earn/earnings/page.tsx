import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZ } from "@/lib/points/rules";
import { CONVERSION_BONUS, EARN_TASKS, SIGNUP_BONUS, WITHDRAW_THRESHOLD, earnPreviewEnabled, stageTasks, withdrawInfo, zikiTaskPath } from "@/lib/earn/draft";
import { earnState } from "@/lib/earn/state";
import { taskStateFor } from "@/lib/earn/progress";
import { EARN_TASK_MINUTES } from "@/lib/earn/task-ui";
import { EarnBar } from "@/components/earn-money";
import { EarnWithdraw } from "@/components/earn-withdraw";
import { agentsLink, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Earnings" };

const dateLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/**
 * Earnings (#earn-drafts, Mark's call of 5 Nov): the way to the first
 * withdrawal, laid out like the earnings design he likes: a goal card with
 * its bar, where the money came from, and the fastest way on to $30 as a list
 * with each task's reward and next step. Same sample earner as the rest of the
 * draft, so every page agrees on one stage.
 */
export default async function EarningsPage() {
  const user = await requireUser();
  const { balance, rows } = await earnState(user.id);
  // What happened, newest first: the welcome, then each task sent in, sent back or paid.
  const [welcome, taskRows] = await Promise.all([
    prisma.pointEntry.findUnique({ where: { sourceKey: `earn:welcome:${user.id}` }, select: { createdAt: true } }).catch(() => null),
    prisma.earnTaskProgress.findMany({ where: { userId: user.id }, select: { taskKey: true, status: true, submittedAt: true, decidedAt: true } }).catch(() => []),
  ]);
  const activity = [
    ...(welcome ? [{ key: "welcome", label: "Sign-up gift", at: welcome.createdAt, amount: SIGNUP_BONUS, note: "", dot: "bg-zk-ok-fg" }] : []),
    ...taskRows.flatMap((row) => {
      const task = EARN_TASKS.find((candidate) => candidate.id === row.taskKey);
      if (!task) return [];
      if (row.status === "confirmed" && row.decidedAt) return [{ key: `${row.taskKey}-paid`, label: `${task.title} was paid`, at: row.decidedAt, amount: task.pay, note: "", dot: "bg-zk-ok-fg" }];
      if (row.status === "rejected" && row.decidedAt) return [{ key: `${row.taskKey}-back`, label: `${task.title} was sent back`, at: row.decidedAt, amount: 0, note: "Fix and resend", dot: "bg-zk-bad-fg" }];
      if (row.status === "submitted" && row.submittedAt) return [{ key: `${row.taskKey}-sent`, label: `You sent ${task.title}`, at: row.submittedAt, amount: 0, note: "Checking", dot: "bg-zk-warn-fg" }];
      return [];
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  // What the tasks Ziki is checking will pay once confirmed.
  const checking = EARN_TASKS.reduce((sum, task, index) => sum + (taskStateFor(rows, index) === "in-review" ? task.pay : 0), 0);
  const info = withdrawInfo(balance.stage, balance.earned, balance.done);
  const ready = balance.withdrawable > 0;
  const taskPay = stageTasks(balance.stage, balance.done).filter((task) => task.done).reduce((sum, task) => sum + task.pay, 0);
  const fromPerson = balance.converted ? CONVERSION_BONUS : 0;
  const left = Math.max(0, WITHDRAW_THRESHOLD - balance.earned);

  const sources = [
    ...(SIGNUP_BONUS > 0 ? [{ label: "Sign-up gift", amount: SIGNUP_BONUS, color: "bg-zk-ok-fg" }] : []),
    { label: "Marketing tasks", amount: taskPay, color: "bg-zk-accent/50" },
    { label: "Open source", amount: fromPerson, color: "bg-amber-300" },
  ];
  const sourcesTotal = sources.reduce((sum, source) => sum + source.amount, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/earn/home" className={`inline-block text-sm ${agentsLink}`}>← What should it work on?</Link>
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Your earnings</h1>
        <p className="text-sm text-zk-text2">What your agent has earned, and the quickest way to your first withdrawal.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section aria-labelledby="goal-heading" className={`${agentsSurface} space-y-4 p-5 sm:p-6`}>
          <div className="flex items-center justify-between gap-3">
            <h2 id="goal-heading" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Your first withdrawal</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ready ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-warn-bg text-zk-warn-fg"}`}>
              {ready ? "Ready to withdraw" : "Held until you do open-source tasks"}
            </span>
          </div>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-5xl font-extrabold leading-none tracking-tight tabular-nums text-zk-text">${balance.earned.toFixed(2)}</span>
            <span className="text-sm text-zk-muted">{ready ? "ready to withdraw" : `of ${formatZ(WITHDRAW_THRESHOLD)} needed to withdraw`}</span>
          </p>
          <EarnBar balance={balance} checking={checking} />
          <dl className="grid grid-cols-3 gap-4 border-t border-zk-divider pt-4">
            <div>
              <dt className="text-xs text-zk-muted">Still to earn</dt>
              <dd className="text-lg font-extrabold tabular-nums text-zk-text">{formatZ(left)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zk-muted">Being checked</dt>
              <dd className="text-lg font-extrabold tabular-nums text-zk-warn-fg">{formatZ(checking)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zk-muted">Ready to withdraw</dt>
              <dd className="text-lg font-extrabold tabular-nums text-zk-ok-fg">{formatZ(balance.withdrawable)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <EarnWithdraw info={info} className={ready ? agentsPrimaryBtn : agentsSecondaryBtn}>
              {ready ? `Withdraw $${balance.withdrawable.toFixed(2)}` : "Withdraw"}
            </EarnWithdraw>
            {ready ? <span className="text-xs text-zk-muted">Paid to the wallet in Settings.</span> : null}
          </div>
        </section>

        <section aria-labelledby="source-heading" className={`${agentsSurface} flex flex-col gap-4 p-5 sm:p-6`}>
          <h2 id="source-heading" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Where it came from</h2>
          <div aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-zk-seg">
            {sources.map((source) =>
              source.amount > 0 && sourcesTotal > 0 ? (
                <span key={source.label} className={`earn-grow h-full ${source.color}`} style={{ width: `${(source.amount / sourcesTotal) * 100}%` }} />
              ) : null,
            )}
          </div>
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
            {sources.map((source) => (
              <li key={source.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-zk-text">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${source.color}`} />
                  {source.label}
                </span>
                <span className="font-bold tabular-nums text-zk-text">{formatZ(source.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-auto border-t border-zk-divider pt-4 text-xs leading-relaxed text-zk-muted">
            Starter jobs on Ziki’s own projects stay held until your work brings in a real person. Then everything unlocks together.
          </p>
        </section>
      </div>

      <section aria-labelledby="fast-heading" className={`${agentsSurface} overflow-hidden`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
          <h2 id="fast-heading" className="text-lg font-extrabold tracking-tight text-zk-text">Fastest way to {formatZ(WITHDRAW_THRESHOLD)}</h2>
          <span className="text-xs text-zk-muted">All four are open. Do them in any order.</span>
        </div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] gap-4 bg-zk-tint/60 px-5 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-zk-muted">
          <span>Est. reward</span>
          <span>Task</span>
          <span className="text-right">Next step</span>
        </div>
        <ol className="m-0 list-none divide-y divide-zk-divider p-0">
          {SIGNUP_BONUS > 0 ? (
            <li className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5">
              <span className="justify-self-start rounded-[10px] bg-zk-ok-bg px-2.5 py-1 text-sm font-extrabold tabular-nums text-zk-ok-fg">+{formatZ(SIGNUP_BONUS)}</span>
              <span className="min-w-0">
                <span className="block text-sm text-zk-text2">You signed up</span>
                <span className="block text-xs text-zk-muted">Paid</span>
              </span>
              <span className="text-right text-xs font-bold text-zk-ok-fg">Paid</span>
            </li>
          ) : null}
          {EARN_TASKS.map((task, index) => {
            const state = taskStateFor(rows, index);
            const sentBack = rows.find((row) => row.taskKey === task.id)?.status === "rejected";
            return (
              <li key={task.id} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5">
                <span className={`justify-self-start rounded-[10px] px-2.5 py-1 text-sm font-extrabold tabular-nums ${state === "paid" ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-chip text-zk-text2"}`}>
                  +{formatZ(task.pay)}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm ${state === "paid" ? "text-zk-text2" : "font-semibold text-zk-text"}`}>{task.title}</span>
                  <span className="block text-xs text-zk-muted">
                    {sentBack ? "Sent back: fix it and send it again" : state === "paid" ? "Paid" : state === "in-review" ? "Ziki is checking it" : state === "in-progress" ? "Started" : `About ${EARN_TASK_MINUTES[task.id]} min`}
                  </span>
                </span>
                <span className="text-right">
                  {state === "paid" ? (
                    <span className="text-xs font-bold text-zk-ok-fg">Paid</span>
                  ) : state === "in-review" ? (
                    <Link href={zikiTaskPath(index + 1)} className={agentsSecondaryBtn}>View</Link>
                  ) : (
                    <Link href={zikiTaskPath(index + 1)} className={agentsPrimaryBtn}>{state === "in-progress" ? "Continue" : "Start"}</Link>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="border-t border-zk-divider bg-zk-bg px-5 py-3 text-xs text-zk-text2">
          The four marketing tasks add up to {formatZ(EARN_TASKS.reduce((sum, task) => sum + task.pay, 0))}. The last {formatZ(CONVERSION_BONUS)} comes from open-source tasks.
        </p>
      </section>

      <section aria-labelledby="activity-heading" className={`${agentsSurface} p-5 sm:p-6`}>
        <h2 id="activity-heading" className="mb-3 text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Activity</h2>
        <ul className="m-0 flex list-none flex-col divide-y divide-zk-divider p-0">
          {activity.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
                <span className="text-zk-text">{item.label}</span>
                <span className="text-xs text-zk-muted">· {dateLabel.format(item.at)}</span>
              </span>
              <span className={`font-bold tabular-nums ${item.amount ? "text-zk-ok-fg" : "text-zk-muted"}`}>{item.amount ? `+${formatZ(item.amount)}` : item.note}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Development only: see this page at the demo stages. */}
      {earnPreviewEnabled() ? (
        <p className="flex flex-wrap gap-x-3 border-t border-dashed border-zk-border pt-4 text-xs text-zk-muted">
          Demo stages:
          <Link href="/earn/preview?state=new&next=/earn/earnings" prefetch={false} className={agentsLink}>Real data</Link>
          <Link href="/earn/preview?state=task2&next=/earn/earnings" prefetch={false} className={agentsLink}>$10, two tasks paid</Link>
          <Link href="/earn/preview?state=progress&next=/earn/earnings" prefetch={false} className={agentsLink}>$19, tasks done</Link>
          <Link href="/earn/preview?state=unlocked&next=/earn/earnings" prefetch={false} className={agentsLink}>$30, unlocked</Link>
        </p>
      ) : null}
    </div>
  );
}
