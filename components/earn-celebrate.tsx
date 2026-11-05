"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { EarnAgentPortrait } from "@/components/earn-agent";

const LINES = [
  "First one down. That was the easy money.",
  "Ten people found. They never saw us coming.",
  "Ten emails sent. Now we wait for the replies.",
  "All four done. Now it only takes one yes.",
];

/** Ten sparks, each flying a different way from the coin. */
const SPARKS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2;
  const reach = 46 + (i % 3) * 14;
  return { dx: Math.round(Math.cos(angle) * reach), dy: Math.round(Math.sin(angle) * reach), color: ["#2e6fef", "#146c43", "#f5b73b"][i % 3] };
});

/**
 * A paid task, celebrated (#earn-drafts): a coin drops, spins and lands, sparks
 * fly off it, the agent hops, and the bar fills from where you were to where you
 * are. It says in plain words what was added and what is left. It shows once
 * (the address is tidied so a refresh doesn't replay it) and can be dismissed.
 * With reduced motion everything is simply there.
 */
export function EarnCelebrate({ agent, taskNumber, pay, from, to, total }: { agent: { id: string; name: string; avatar: string | null } | null; taskNumber: number; pay: number; from: number; to: number; total: number }) {
  const pathname = usePathname();
  const [shown, setShown] = useState(true);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    // Tidy the address so a refresh does not replay this. history.replaceState does not ask the server again, so this card stays.
    window.history.replaceState(null, "", pathname);
    const timer = setTimeout(() => setFilled(true), 350);
    return () => clearTimeout(timer);
  }, [pathname]);

  if (!shown) return null;
  const left = Math.max(0, total - to);
  return (
    <section aria-live="polite" aria-label="Task paid" className="relative overflow-hidden rounded-[20px] border border-zk-ok-fg/25 bg-zk-ok-bg/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
          {SPARKS.map((spark, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="earn-spark absolute h-2 w-2 rounded-full opacity-0"
              style={{ background: spark.color, ["--dx" as string]: `${spark.dx}px`, ["--dy" as string]: `${spark.dy}px` }}
            />
          ))}
          <span aria-hidden="true" className="earn-coin relative flex h-16 w-16 items-center justify-center rounded-full border-4 border-amber-500 bg-amber-300 text-2xl font-extrabold text-amber-800 shadow-[0_6px_16px_rgba(180,120,0,0.35)]">$</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-3xl font-extrabold tabular-nums tracking-tight text-zk-ok-fg">+${pay.toFixed(2)}</span>
            <span className="text-sm font-bold text-zk-text">Task {taskNumber} paid</span>
          </p>
          <p className="earn-hop flex items-center gap-2 text-sm text-zk-text2">
            {agent ? <EarnAgentPortrait agentId={agent.id} agentName={agent.name} avatar={agent.avatar} size={26} /> : null}
            <span><b className="text-zk-text">{agent?.name ?? "Your agent"}:</b> {LINES[Math.min(taskNumber, LINES.length) - 1]}</span>
          </p>
        </div>
        <button type="button" onClick={() => setShown(false)} className="self-start rounded-full px-3 py-1.5 text-sm font-semibold text-zk-text2 hover:bg-zk-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue">Dismiss</button>
      </div>
      {/* The bar fills from where you were to where you are. */}
      <div className="mt-4">
        <div className="h-2.5 overflow-hidden rounded-full bg-zk-surface/80" role="img" aria-label={`$${to.toFixed(2)} of $${total}`}>
          <div className="h-full rounded-full bg-zk-ok-fg transition-[width] duration-[900ms] ease-out motion-reduce:transition-none" style={{ width: `${((filled ? to : from) / total) * 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-zk-text2">${to.toFixed(2)} of ${total}. {left > 0 ? `$${left.toFixed(2)} to go.` : "Withdraw is open."}</p>
      </div>
    </section>
  );
}
