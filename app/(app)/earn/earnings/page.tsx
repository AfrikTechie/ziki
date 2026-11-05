import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZ } from "@/lib/points/rules";
import { CONVERSION_BONUS, EARN_TASKS, SIGNUP_BONUS, WITHDRAW_THRESHOLD, earnAgentActivity, earnPreviewEnabled, stageTasks, withdrawInfo } from "@/lib/earn/draft";
import { earnBalanceFor } from "@/lib/earn/state";
import { EarnBar } from "@/components/earn-money";
import { EarnWithdraw } from "@/components/earn-withdraw";
import { EarnAgentPortrait } from "@/components/earn-agent";
import { agentPageHref } from "@/lib/header-nav";
import { agentsLink, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { earnAgentWhere } from "@/lib/earn/earner";

export const metadata = { title: "Earnings" };

/**
 * Earnings (#earn-drafts, Mark's call of 5 Nov): the way to the first
 * withdrawal, laid out like the earnings design he likes: a goal card with
 * its bar, where the money came from, and the fastest way on to $30 as a list
 * with each task's reward and next step. Same sample earner as the rest of the
 * draft, so every page agrees on one stage.
 */
export default async function EarningsPage() {
  const user = await requireUser();
  const balance = await earnBalanceFor(user.id);
  const agent = await prisma.agent.findFirst({ where: earnAgentWhere(user.id), orderBy: { createdAt: "asc" }, select: { id: true, name: true, avatar: true, username: true } }).catch(() => null);
  const info = withdrawInfo(balance.stage, balance.earned);
  const ready = balance.withdrawable > 0;
  const taskPay = stageTasks(balance.stage).filter((task) => task.done).reduce((sum, task) => sum + task.pay, 0);
  const fromPerson = balance.converted ? CONVERSION_BONUS : 0;
  const left = Math.max(0, WITHDRAW_THRESHOLD - balance.earned);

  const sources = [
    ...(SIGNUP_BONUS > 0 ? [{ label: "Sign-up gift", amount: SIGNUP_BONUS }] : []),
    { label: "Market Ziki tasks", amount: taskPay },
    { label: "People you reached", amount: fromPerson },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Your earnings</h1>
        <p className="text-sm text-zk-text2">What your agent has earned, and the quickest way to your first withdrawal.</p>
      </div>

      {/* The started page (Mark's four pages): how the agent is doing comes first. */}
      {agent ? (
        // Click the agent to open its page, where its look and name are edited.
        <Link href={agentPageHref(agent.username)} aria-label={`${agent.name}: open its page to edit it`} className={`${agentsSurface} flex items-center gap-3 p-4 transition hover:border-electric-blue/50 hover:shadow-[0_10px_28px_rgba(11,23,51,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue`}>
          <span className="relative shrink-0">
            <EarnAgentPortrait agentId={agent.id} agentName={agent.name} avatar={agent.avatar} size={48} />
            <span aria-hidden="true" className="absolute -right-0.5 bottom-0 h-3 w-3 rounded-full border-2 border-zk-surface bg-zk-ok-fg motion-safe:animate-pulse" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-zk-text">{agent.name}</span>
            <span className="block text-sm text-zk-text2">{earnAgentActivity(balance.stage)}</span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zk-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </Link>
      ) : null}

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
          <EarnBar balance={balance} />
          <dl className="grid grid-cols-3 gap-4 border-t border-zk-divider pt-4">
            <div>
              <dt className="text-xs text-zk-muted">Still to earn</dt>
              <dd className="text-lg font-extrabold tabular-nums text-zk-text">{formatZ(left)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zk-muted">From your tasks</dt>
              <dd className="text-lg font-extrabold tabular-nums text-zk-info-fg">{formatZ(Math.min(balance.tasksLeft, left))}</dd>
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
            <span className="text-xs text-zk-muted">{ready ? "Paid to the wallet in Settings." : `Opens at ${formatZ(WITHDRAW_THRESHOLD)}.`}</span>
          </div>
        </section>

        <section aria-labelledby="source-heading" className={`${agentsSurface} flex flex-col gap-4 p-5 sm:p-6`}>
          <h2 id="source-heading" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Where it came from</h2>
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
            {sources.map((source) => (
              <li key={source.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-zk-text">{source.label}</span>
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
          <span className="text-xs text-zk-muted">Your agent does them in order</span>
        </div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] gap-4 bg-zk-tint/60 px-5 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-zk-muted">
          <span>Est. reward</span>
          <span>Task</span>
          <span className="text-right">Next step</span>
        </div>
        <ol className="m-0 list-none divide-y divide-zk-divider p-0">
          {info.ways.map((way) => (
            <li key={way.label} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5">
              <span className={`justify-self-start rounded-[10px] px-2.5 py-1 text-sm font-extrabold tabular-nums ${way.done ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-chip text-zk-text2"}`}>
                +{formatZ(way.pay)}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm ${way.done ? "text-zk-text2" : "font-semibold text-zk-text"}`}>{way.label}</span>
                <span className="block text-xs text-zk-muted">{way.done ? "Paid" : way.next ? "Next up" : "After the one above"}</span>
              </span>
              <span className="text-right">
                {way.done ? (
                  <span className="text-xs font-bold text-zk-ok-fg">✓ Paid</span>
                ) : way.next && way.href ? (
                  <Link href={way.href} className={agentsPrimaryBtn}>Start</Link>
                ) : (
                  <span className="text-xs text-zk-muted">Waiting</span>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className="border-t border-zk-divider bg-zk-bg px-5 py-3 text-xs text-zk-text2">
          The four marketing tasks add up to {formatZ(EARN_TASKS.reduce((sum, task) => sum + task.pay, 0))}. The last {formatZ(CONVERSION_BONUS)} comes from open-source tasks.
        </p>
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
