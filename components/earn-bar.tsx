import { formatZ } from "@/lib/points/rules";
import { CONVERSION_BONUS, EARN_TASKS, SIGNUP_BONUS, WITHDRAW_THRESHOLD, type EarnBalance } from "@/lib/earn/draft";

/**
 * The road to the first withdrawal (#earn-drafts), laid out like the earnings
 * bar Mark likes: a segmented bar, a marker at the end, a legend with colour
 * dots. Three colours: what you've earned (green), what your tasks can still
 * add (blue), and what arrives from open-source tasks
 * (amber). A small notch marks where each task pays out, so the bar reads as a
 * road and not a meter, and a glowing dot sits at your head of it.
 */
export function EarnBar({ balance, checking = 0 }: { balance: Pick<EarnBalance, "earned" | "tasksLeft">; /** What tasks being checked will pay once confirmed. */ checking?: number }) {
  const total = WITHDRAW_THRESHOLD;
  const earned = Math.min(balance.earned, total);
  const left = Math.max(0, total - balance.earned);
  const inReview = Math.min(checking, left, balance.tasksLeft);
  const fromTasks = Math.min(balance.tasksLeft, left) - inReview;
  const fromPerson = left - fromTasks - inReview;
  const ready = left === 0;
  const pct = (value: number) => `${(value / total) * 100}%`;

  // Where each payout lands on the bar: the sign-up gift, then each task in turn (5, 8, 10, 14, 19).
  const stops: number[] = [];
  EARN_TASKS.reduce((sum, task) => {
    stops.push(sum);
    return sum + task.pay;
  }, SIGNUP_BONUS);
  const notches = stops.filter((value) => value < total);

  const parts = [
    { key: "earned", value: earned, bar: "bg-zk-ok-fg", dot: "bg-zk-ok-fg", text: "font-bold text-zk-text", label: "earned", show: balance.earned >= 0 },
    { key: "checking", value: inReview, bar: "bg-[repeating-linear-gradient(45deg,#f2c14e_0,#f2c14e_6px,#f7d98a_6px,#f7d98a_12px)]", dot: "bg-[#f2c14e]", text: "font-bold text-zk-warn-fg", label: "Ziki is checking", show: inReview > 0 },
    { key: "tasks", value: fromTasks, bar: "bg-zk-accent/35", dot: "bg-zk-accent/40", text: "font-bold text-zk-accent", label: "from your tasks", show: fromTasks > 0 },
    { key: "person", value: fromPerson, bar: "bg-amber-300", dot: "bg-amber-300", text: "font-bold text-zk-warn-fg", label: "from open-source tasks", show: fromPerson > 0 },
  ];

  return (
    <div>
      <div className="relative pt-6">
        {/* The marker at the end: where withdrawing opens. */}
        <span className={`absolute right-0 top-0 text-[11px] font-bold ${ready ? "text-zk-ok-fg" : "text-zk-muted"}`}>{ready ? "Withdraw is open" : `Withdraw opens at ${formatZ(total)}`}</span>
        <span aria-hidden="true" className={`absolute right-0 top-4 z-10 h-6 w-0.5 rounded-full ${ready ? "bg-zk-ok-fg" : "bg-zk-text"}`} />
        <div
          role="img"
          aria-label={
            ready
              ? `${formatZ(balance.earned)} earned. Withdraw is open.`
              : `${formatZ(balance.earned)} earned. ${fromTasks ? `${formatZ(fromTasks)} to come from your tasks. ` : ""}${formatZ(fromPerson)} from open-source tasks. Withdraw opens at ${formatZ(total)}.`
          }
          className="relative flex h-3.5 overflow-hidden rounded-full bg-zk-seg"
        >
          {parts.map((part) =>
            part.show && part.value > 0 ? (
              <div key={part.key} className="h-full" style={{ width: pct(part.value) }}>
                <div className={`earn-grow h-full w-full ${part.bar}`} />
              </div>
            ) : null,
          )}
          {/* Where each payout lands. */}
          {notches.map((value) => (
            <span key={value} aria-hidden="true" className="absolute top-0 h-full w-[2px] bg-zk-surface/80" style={{ left: pct(value) }} />
          ))}
        </div>
        {/* You are here. */}
        {earned > 0 && !ready ? (
          <span aria-hidden="true" className="absolute top-[18px] z-10 flex h-[22px] w-[22px] -translate-x-1/2 items-center justify-center" style={{ left: pct(earned) }}>
            <span className="absolute h-full w-full rounded-full bg-zk-ok-fg/30 motion-safe:animate-ping" />
            <span className="relative h-3.5 w-3.5 rounded-full border-[3px] border-zk-surface bg-zk-ok-fg shadow-[0_1px_4px_rgba(11,23,51,0.35)]" />
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zk-text2">
        {parts.map((part) =>
          part.show ? (
            <span key={part.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${part.dot}`} />
              <span className={part.text}>{formatZ(part.key === "earned" ? balance.earned : part.key === "person" ? CONVERSION_BONUS : part.value)}</span> {part.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
