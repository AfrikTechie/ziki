import Link from "next/link";
import { formatZ } from "@/lib/points/rules";
import { WITHDRAW_THRESHOLD, stagePeople, withdrawInfo, type EarnBalance } from "@/lib/earn/draft";
import { EarnWithdraw } from "@/components/earn-withdraw";
import { EarnBar } from "@/components/earn-bar";

export { EarnBar };
import { agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export function LockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * Your money on My agents (#earn-drafts, Mark's review): the balance, the bar
 * to $30, and Withdraw, never locked: below $30 it opens a window with the
 * threshold and how to reach it. Under it, the next Ziki task and Start; the
 * tasks themselves live in the main list.
 */
export function EarnMoney({ balance }: { balance: EarnBalance }) {
  const ready = balance.withdrawable > 0;
  const info = withdrawInfo(balance.stage, balance.earned, balance.done);
  // Once the tasks are paid, the person closest to starting a project is the next step.
  const closest = stagePeople(balance.stage).find((person) => person.signedUp && !person.started);
  return (
    <section id="earn-money" aria-labelledby="earn-money-heading" className={`${agentsSurface} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="earn-money-heading" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Earned</h2>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[32px] font-extrabold leading-none tracking-tight tabular-nums text-zk-text">${balance.earned.toFixed(2)}</span>
            <span className="text-sm text-zk-muted">{ready ? "ready to withdraw" : `of ${formatZ(WITHDRAW_THRESHOLD)} to withdraw`}</span>
          </p>
        </div>
        <EarnWithdraw info={info} className={ready ? agentsPrimaryBtn : agentsSecondaryBtn}>
          {ready ? `Withdraw $${balance.withdrawable.toFixed(2)}` : "Withdraw"}
        </EarnWithdraw>
      </div>
      <div className="mt-4">
        <EarnBar balance={balance} />
      </div>
      {info.next ? (
        // The next Ziki task, with Start.
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] bg-zk-tint/70 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-zk-text2">
            <span className="font-bold text-zk-text">
              Next: {info.next.title} <span className="text-zk-ok-fg">+{formatZ(info.next.pay)}</span>
            </span>
          </p>
          <Link href={info.next.href} className={agentsPrimaryBtn}>Start</Link>
        </div>
      ) : !ready && closest ? (
        // Tasks done, $11 to go: name the one person who can unlock it, and the one thing to do.
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] bg-zk-tint/70 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-zk-text2">
            <span className="font-bold text-zk-text">
              {formatZ(WITHDRAW_THRESHOLD - balance.earned)} to go. {closest.name} signed up on {closest.signedUp}.
            </span>{" "}
            A friendly follow-up often gets them started.
          </p>
          <Link href="/earn/people" className={agentsPrimaryBtn}>Send a follow-up</Link>
        </div>
      ) : null}
    </section>
  );
}
