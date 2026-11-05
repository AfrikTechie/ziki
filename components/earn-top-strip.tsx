import Link from "next/link";
import { formatZ } from "@/lib/points/rules";
import { WITHDRAW_THRESHOLD, type EarnBalance } from "@/lib/earn/draft";

/**
 * A slim strip across the top of the earner's task pages (#earn-drafts, Mark's
 * call of 5 Nov): what you have so far, in one line, apart from the tasks. No
 * Withdraw and no full bar here: those live on Earnings.
 */
export function EarnTopStrip({ balance }: { balance: Pick<EarnBalance, "earned"> }) {
  const share = Math.min(100, (balance.earned / WITHDRAW_THRESHOLD) * 100);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border border-zk-border bg-zk-surface px-4 py-2.5">
      <span className="text-sm font-extrabold tabular-nums text-zk-text">${balance.earned.toFixed(2)}</span>
      <span className="text-xs text-zk-muted">of {formatZ(WITHDRAW_THRESHOLD)}</span>
      <span role="img" aria-label={`${formatZ(balance.earned)} of ${formatZ(WITHDRAW_THRESHOLD)}`} className="h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-zk-seg">
        <span className="earn-grow block h-full rounded-full bg-zk-ok-fg" style={{ width: `${share}%` }} />
      </span>
      <Link href="/earn/earnings" className="ml-auto text-xs font-semibold text-zk-accent hover:underline">Earnings →</Link>
    </div>
  );
}
