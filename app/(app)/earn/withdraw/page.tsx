import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZ } from "@/lib/points/rules";
import { CONVERSION_BONUS, WITHDRAW_THRESHOLD, earnPreviewEnabled, stagePeople, stageTasks } from "@/lib/earn/draft";
import { earnBalanceFor } from "@/lib/earn/state";
import { EarnBar, LockIcon } from "@/components/earn-money";
import { agentsLink, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { earnAgentWhere } from "@/lib/earn/earner";

export const metadata = { title: "Withdraw" };

/**
 * Withdraw (#earn-drafts), as in Uche's design. Under $30 it shows what you
 * have, a locked button, and the steps to $30 in order. At $30 it asks how
 * much and pays to the address kept in Settings (#618).
 */
export default async function EarnWithdrawPage() {
  const user = await requireUser();
  const balance = await earnBalanceFor(user.id);
  const ready = balance.withdrawable > 0;
  const left = Math.max(0, WITHDRAW_THRESHOLD - balance.earned);
  const [agent] = await Promise.all([
    prisma.agent.findFirst({ where: earnAgentWhere(user.id), orderBy: { createdAt: "asc" }, select: { name: true } }).catch(() => null),
  ]);
  const tasks = stageTasks(balance.stage);
  const signedUp = stagePeople(balance.stage).filter((person) => person.signedUp).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/earn/earnings" className={`text-sm ${agentsLink}`}>← My earnings</Link>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Withdraw</h1>
        <p className="mt-1 text-sm text-zk-text2">
          {ready ? "You’ve reached the threshold." : `Withdrawals open at ${formatZ(WITHDRAW_THRESHOLD)}.`}
        </p>
      </div>

      {/* As wide as the task pages, one column: the money, then what gets you to $30. */}
      <div className="space-y-4">
      {ready ? (
        <section aria-labelledby="available" className={`${agentsSurface} space-y-4 p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="available" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Available</h2>
              <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums text-zk-text">${balance.withdrawable.toFixed(2)}</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-zk-ok-bg px-2.5 py-1 text-xs font-bold text-zk-ok-fg">✓ Ready</span>
          </div>
          <p className="text-sm leading-relaxed text-zk-text2">
            Your money is ready. We’re still working out how payouts will work, and we’ll tell you as soon as you can take it out.
          </p>
        </section>
      ) : (
        <section aria-labelledby="available" className={`${agentsSurface} space-y-4 p-5`}>
          <div>
            <h2 id="available" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Earned so far</h2>
            <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums text-zk-text">${balance.earned.toFixed(2)}</p>
          </div>
          <EarnBar balance={balance} />
          <p className="text-sm text-zk-text2">
            {balance.earned === 0
              ? "Start with your first task. Each one you finish adds to this."
              : balance.tasksLeft > 0
                ? `${formatZ(left)} to go: ${formatZ(balance.tasksLeft)} from your tasks, then ${formatZ(CONVERSION_BONUS)} from open-source tasks.`
                : `${formatZ(left)} to go. It comes from open-source tasks. What you've earned stays yours.`}
          </p>
          <button type="button" disabled className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-zk-seg px-5 text-sm font-bold text-zk-muted">
            <LockIcon />
            Withdraw at {formatZ(WITHDRAW_THRESHOLD)}
          </button>
        </section>
      )}

      {ready ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-zk-border bg-zk-tint px-5 py-4 text-sm text-zk-text2">
          <p className="min-w-0 flex-1">
            <span className="font-bold text-zk-text">Keep earning.</span> {agent?.name ?? "Your agent"} can now bid on project work.
          </p>
          <Link href="/tenants" className={agentsLink}>Join a workspace →</Link>
        </div>
      ) : (
        <section aria-labelledby="reach" className={`${agentsSurface} overflow-hidden`}>
          <div className="px-5 pb-2 pt-4">
            <h2 id="reach" className="text-base font-bold text-zk-text">How to reach {formatZ(WITHDRAW_THRESHOLD)}</h2>
            <p className="text-xs text-zk-muted">Your tasks, in order.</p>
          </div>
          <ol className="m-0 list-none divide-y divide-zk-border border-t border-zk-border p-0">
            {tasks.map((task, index) => (
              <li key={task.id} className="flex items-center gap-3 px-5 py-3">
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${task.done ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-chip text-zk-muted"}`}
                >
                  {task.done ? "✓" : index + 1}
                </span>
                <span className={`min-w-0 flex-1 text-sm ${task.done ? "text-zk-text2" : "font-semibold text-zk-text"}`}>
                  {task.done ? task.title : <Link href={`/earn/${task.id}`} className={agentsLink}>{task.title}</Link>}
                </span>
                <span className={`font-mono text-sm font-bold tabular-nums ${task.done ? "text-zk-ok-fg" : "text-zk-text"}`}>
                  {task.done ? "+" : ""}{formatZ(task.pay)}
                </span>
              </li>
            ))}
            <li className="flex items-center gap-3 px-5 py-3">
              <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-electric-blue-strong text-xs font-bold text-white">
                {tasks.length + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zk-text">Fix open-source issues</span>
                <span className="block text-xs text-zk-muted">
                  {signedUp > 0 ? (
                    <>Unlocks your withdrawal · {signedUp} has signed up. <Link href="/earn/people" className={agentsLink}>See people →</Link></>
                  ) : (
                    "Unlocks your withdrawal. The people you email come first."
                  )}
                </span>
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-zk-text">{formatZ(CONVERSION_BONUS)}</span>
            </li>
          </ol>
        </section>
      )}

      </div>

      <p className="text-xs text-zk-muted">
        Paid to the wallet address in <Link href="/settings" className={agentsLink}>Settings</Link>.
      </p>

      {/* Development only: see this page at the demo stages. */}
      {earnPreviewEnabled() ? (
        <p className="flex flex-wrap gap-x-3 border-t border-dashed border-zk-border pt-4 text-xs text-zk-muted">
          Demo stages:
          <Link href="/earn/preview?state=new" prefetch={false} className={agentsLink}>Real data</Link>
          <Link href="/earn/preview?state=progress" prefetch={false} className={agentsLink}>$19, tasks done</Link>
          <Link href="/earn/preview?state=unlocked" prefetch={false} className={agentsLink}>$30, unlocked</Link>
        </p>
      ) : null}
    </div>
  );
}
