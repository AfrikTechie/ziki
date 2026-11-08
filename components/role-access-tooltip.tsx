"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { RoleAccess } from "@/lib/role-access";

/** How long the card waits to close after the pointer leaves, long enough to cross the gap to it. */
const CLOSE_DELAY_MS = 150;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2";

/**
 * The role badge in the account menu, with a card that says what the role can
 * and cannot do. It opens on hover, on keyboard focus and on click (touch has
 * no hover), stays open while the pointer is on the card so the link inside is
 * reachable, and closes on Escape or when the pointer or focus leaves. Closing
 * on hover waits a moment, so crossing the gap between the badge and the card
 * does not shut it.
 *
 * The card is positioned against the nearest positioned ancestor (the account
 * summary), so it is as wide as the menu and never runs off a narrow screen.
 */
export function RoleAccessBadge({
  label,
  access,
  organisationName,
  requestHref,
}: {
  /** The text on the badge. */
  label: string;
  access: RoleAccess;
  organisationName?: string | null;
  /** Where "Request upgraded access" goes. */
  requestHref: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardId = useId();

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => cancelClose, []);

  return (
    // role="presentation": the wrapper only listens, so hover and Escape reach the badge and card inside it.
    <span
      ref={wrapperRef}
      role="presentation"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={() => {
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
      }}
      onBlur={(event) => {
        if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Close the card only: the account menu's own Escape handling stays for the next press.
          event.stopPropagation();
          cancelClose();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        aria-label={`${label}: what this role can do`}
        // Click only opens: hover and focus have already opened it for a mouse or keyboard, and a toggle here would shut it again.
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-full bg-zk-surface px-2 py-0.5 font-bold text-zk-text2 hover:bg-zk-chip ${focusRing}`}
      >
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="shrink-0 text-zk-muted">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>

      {open ? (
        <div
          id={cardId}
          role="region"
          aria-label={`Your access as ${access.title}`}
          className="absolute inset-x-0 top-full z-10 mt-2 rounded-2xl border border-zk-border bg-zk-surface p-4 text-left shadow-[0_16px_40px_rgba(11,23,51,0.22)] motion-safe:animate-[header-pop_120ms_ease-out]"
        >
          {/* The pointer to the badge. */}
          <span aria-hidden="true" className="absolute -top-1.5 left-24 h-3 w-3 rotate-45 border-l border-t border-zk-border bg-zk-surface" />

          <p className="text-sm font-extrabold text-zk-text">{access.title}</p>
          <p className="mt-0.5 text-xs text-zk-muted">
            {organisationName ? `Your role in ${organisationName}` : "Your role"}
          </p>

          <AccessList heading="You can" items={access.can} tone="can" />
          <AccessList heading="You can't" items={access.cannot} tone="cannot" />

          <div className="mt-3 border-t border-zk-divider pt-3">
            <Link
              href={requestHref}
              className={`rounded text-xs font-bold text-zk-accent underline underline-offset-2 hover:opacity-80 ${focusRing}`}
            >
              Request upgraded access <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function AccessList({
  heading,
  items,
  tone,
}: {
  heading: string;
  items: readonly string[];
  tone: "can" | "cannot";
}) {
  const headingId = useId();
  const can = tone === "can";
  return (
    <div className="mt-3">
      <p id={headingId} className={`text-[11px] font-extrabold uppercase tracking-wide ${can ? "text-zk-ok-fg" : "text-zk-bad-fg"}`}>
        {heading}
      </p>
      <ul aria-labelledby={headingId} className="mt-1 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-xs font-medium text-zk-text">
            <span aria-hidden="true" className={`w-3 shrink-0 text-center font-bold ${can ? "text-zk-ok-fg" : "text-zk-bad-fg"}`}>
              {can ? "✓" : "✕"}
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
