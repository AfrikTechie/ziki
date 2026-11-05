"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WithdrawInfo } from "@/lib/earn/draft";
import { EarnBar } from "@/components/earn-bar";
import { EarnWithdraw } from "@/components/earn-withdraw";

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * The earner's money in the header (#earn-drafts, Mark's call of 5 Nov): one capsule with just the balance
 * ("$5.00") and Withdraw beside it.
 * The balance opens a window in the middle of the page with the dollars and a link to Earnings, and
 * no Withdraw inside it. Withdraw opens its own window with the threshold; neither takes you to another page.
 */
export function EarnPill({ info }: { info: WithdrawInfo }) {
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

  return (
    <>
      <div className="inline-flex h-10 items-center gap-1 rounded-full border border-zk-border bg-zk-surface py-1 pl-1 pr-1 text-zk-text max-sm:h-9">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 items-center gap-2 rounded-full pl-2.5 pr-2.5 hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue max-sm:h-7 max-sm:pl-2"
        >
          <span className="text-[14px] font-bold tabular-nums">{money(info.earned)}</span>
        </button>
        <EarnWithdraw
          info={info}
          className="inline-flex h-8 items-center rounded-full bg-electric-blue-strong px-3 text-[13px] font-semibold text-white hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue max-sm:h-7 max-sm:px-2.5 max-sm:text-xs"
        >
          Withdraw
        </EarnWithdraw>
      </div>

      {open ? (
        // Clicking the backdrop closes it; Escape is handled by onCancel, so the click needs no key listener.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <dialog
          ref={dialogRef}
          aria-labelledby="earn-balance-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-[20px] border border-zk-border bg-zk-surface p-6 text-zk-text shadow-xl backdrop:bg-black/40"
        >
          <h2 id="earn-balance-title" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Your balance</h2>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums text-zk-text">{money(info.earned)}</span>
            <span className="text-sm text-zk-muted">{info.ready ? "ready to withdraw" : `of $${info.threshold} to withdraw`}</span>
          </p>
          <div className="mt-5">
            <EarnBar balance={{ earned: info.earned, tasksLeft: info.fromTasks }} />
          </div>
          {info.next ? (
            <p className="mt-5 rounded-[14px] bg-zk-tint/70 px-4 py-3 text-sm text-zk-text2">
              <span className="font-bold text-zk-text">Next: {info.next.title}</span> <span className="font-bold text-zk-ok-fg">+${info.next.pay}</span>
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={close}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-bold text-zk-text hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
            >
              Close
            </button>
            <Link
              href="/earn/earnings"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
            >
              See my earnings
            </Link>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
