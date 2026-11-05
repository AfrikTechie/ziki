"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WithdrawInfo } from "@/lib/earn/draft";
import { EarnBar } from "@/components/earn-bar";

const money = (n: number) => `$${n.toFixed(2)}`;
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(46,111,239,0.30)] transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";

/**
 * Withdraw (#earn-drafts, Mark's review): always a window over the page you are
 * on, never a trip to another page. It shows the threshold and your balance
 * against it, with a link to the full Earnings page. Below the threshold it lists every way to get there, with the next
 * one to do; at the threshold or more it offers the withdrawal.
 *
 * DRAFT: there is no payout backend yet, so the Withdraw button only closes the window.
 */
export function EarnWithdraw({
  info,
  className,
  children,
}: {
  info: WithdrawInfo;
  /** The button's own look (the header menu's, or a card button). */
  className: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  const left = Math.max(0, info.threshold - info.earned);

  return (
    <>
      <button ref={buttonRef} type="button" onClick={() => setOpen(true)} className={className} aria-haspopup="dialog">
        {children}
      </button>
      {open ? (
        // Clicking the backdrop closes it; Escape is handled by onCancel, so the click needs no key listener.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <dialog
          ref={dialogRef}
          aria-labelledby="earn-withdraw-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[20px] border border-zk-border bg-zk-surface p-6 text-zk-text shadow-xl backdrop:bg-black/40"
        >
          <h2 id="earn-withdraw-title" className="text-xl font-extrabold tracking-tight text-zk-text">
            {info.ready ? `You’ve reached $${info.threshold}` : `Withdrawals open at $${info.threshold}`}
          </h2>
          <p className="mt-1 text-sm text-zk-text2">
            {info.ready ? "Your money is ready. We’re still working out how payouts will work, and we’ll tell you as soon as you can take it out." : `You have ${money(info.earned)}. ${money(left)} to go.`}
          </p>

          <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[34px] font-extrabold leading-none tracking-tight tabular-nums text-zk-text">{money(info.earned)}</span>
            <span className="text-sm text-zk-muted">{info.ready ? "ready" : `of $${info.threshold} to withdraw`}</span>
          </p>
          <div className="mt-4">
            <EarnBar balance={{ earned: info.earned, tasksLeft: info.fromTasks }} />
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={close} className={SECONDARY}>Close</button>
            <Link href="/earn/earnings" onClick={() => setOpen(false)} className={SECONDARY}>See my earnings</Link>
            {info.ready ? null : info.next ? (
              <Link href={info.next.href} onClick={() => setOpen(false)} className={PRIMARY}>Start next task</Link>
            ) : (
              <Link href="/earn/people" onClick={() => setOpen(false)} className={PRIMARY}>See people you reached</Link>
            )}
          </div>
        </dialog>
      ) : null}
    </>
  );
}
