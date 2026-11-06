"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

const COLORS = ["#2e6fef", "#146c43", "#f5b73b", "#7c3aed", "#e2476b", "#18a2b8"];

/**
 * Two party poppers going off, one from each bottom corner of the window: each piece shoots up and out, then
 * falls. Fixed numbers, so the burst is the same on the server and in the browser.
 */
const PIECES = Array.from({ length: 64 }, (_, i) => {
  const side = i % 2 === 0 ? -1 : 1;
  const spread = (i * 37) % 60; // 0..59, a spread of angles
  const angle = ((40 + spread) * Math.PI) / 180; // 40..99 degrees from flat
  const power = 170 + ((i * 53) % 150);
  return {
    left: side === -1 ? "6%" : "94%",
    dx: Math.round(-side * Math.cos(angle) * power),
    dy: Math.round(-Math.sin(angle) * power),
    fall: 220 + ((i * 29) % 140),
    spin: ((i * 71) % 720) - 360,
    color: COLORS[i % COLORS.length],
    shape: i % 3,
    delay: (i % 8) * 18,
  };
});

/**
 * A celebration (#earn-celebrate): a window in the middle of the page and two bursts of confetti, like party
 * poppers, then the amount, one line and one button. Used for the $5 welcome and for each paid task. It is a
 * real dialog (focus moves into it, Escape and the backdrop close it). With reduced motion there is no burst.
 */
export function EarnCelebrationModal({
  amount,
  title,
  message,
  action,
  onClose,
}: {
  amount: number;
  title: string;
  message: string;
  action?: { href: string; label: string };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    // Clicking the backdrop closes it; Escape is handled by onCancel, so the click needs no key listener.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-labelledby="earn-celebrate-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // The dialog fills the screen (transparent) so the confetti can fly past the card's edges; the card sits in the middle.
      className="m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center overflow-hidden bg-transparent p-4 backdrop:bg-black/45"
    >
      <div className="earn-pop relative w-[min(26rem,100%)] rounded-[24px] border border-zk-border bg-zk-surface text-zk-text shadow-2xl">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-6 z-10 h-0">
        {PIECES.map((piece, i) => (
          <span
            key={i}
            className={`earn-confetti absolute opacity-0 ${piece.shape === 0 ? "h-2 w-3.5 rounded-[2px]" : piece.shape === 1 ? "h-3 w-1.5 rounded-[2px]" : "h-2.5 w-2.5 rounded-full"}`}
            style={{
              left: piece.left,
              background: piece.color,
              ["--dx" as string]: `${piece.dx}px`,
              ["--dy" as string]: `${piece.dy}px`,
              ["--fall" as string]: `${piece.fall}px`,
              ["--spin" as string]: `${piece.spin}deg`,
              animationDelay: `${150 + piece.delay}ms`,
            }}
          />
        ))}
      </div>
      <div className="relative flex flex-col items-center px-6 pb-6 pt-9 text-center">
        <p className="earn-cheer text-5xl font-extrabold tabular-nums tracking-tight text-zk-ok-fg">+${amount.toFixed(2)}</p>
        <h2 id="earn-celebrate-title" className="mt-2 text-xl font-extrabold tracking-tight text-zk-text">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-zk-text2">{message}</p>
        <div className="mt-6 flex w-full flex-wrap justify-center gap-2">
          {action ? (
            <Link href={action.href} onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-full bg-electric-blue-strong px-6 text-sm font-bold text-white transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2">
              {action.label}
            </Link>
          ) : null}
          <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-6 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue">
            {action ? "Later" : "Nice"}
          </button>
        </div>
      </div>
      </div>
    </dialog>
  );
}
