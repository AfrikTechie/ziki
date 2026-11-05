"use client";

import { useRef, useState } from "react";

/**
 * Phones: one icon beside the Issues title that shows or hides the search,
 * filter and sort controls, so they don't take a row of their own.
 * The controls stay in the page; the heading's data attribute drives the CSS.
 */
export function IssuesToolsToggle({ active = false }: { active?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  function toggle() {
    const heading = ref.current?.closest<HTMLElement>(".issues-heading");
    const next = !open;
    heading?.toggleAttribute("data-tools-open", next);
    setOpen(next);
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      aria-expanded={open}
      title="Search and filters"
      className={`issues-tools-toggle relative inline-flex h-8 w-8 items-center justify-center rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue md:hidden ${
        open ? "border-zk-accent bg-zk-tint text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text2"
      }`}
    >
      <span className="sr-only">Search and filters</span>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </svg>
      {/* A search or filter is applied: show it even while closed. */}
      {active ? (
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-zk-surface bg-electric-blue-strong" />
      ) : null}
    </button>
  );
}
