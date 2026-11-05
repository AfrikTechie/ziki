"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";

type RowState = { open: boolean; toggle: () => void; panelId: string };

const RowContext = createContext<RowState | null>(null);

/**
 * A list row that can open its details in place, under the row (#live-confirm).
 * The issue list's table clips anything that floats, so the details push the
 * rows below down instead. Without `details` it is a plain row.
 */
export function ExpandableRow({ className, details, children }: { className: string; details: ReactNode | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!details) return <li className={className}>{children}</li>;
  return (
    <li className={`${className} flex-wrap`} data-open={open || undefined}>
      <RowContext.Provider value={{ open, toggle: () => setOpen((value) => !value), panelId }}>{children}</RowContext.Provider>
      {open ? (
        <div id={panelId} className="basis-full pl-0 lg:pl-[92px]">
          {details}
        </div>
      ) : null}
    </li>
  );
}

/** What opens an ExpandableRow's details: a button (around `children`, if any), or just `children` outside one. */
export function RowToggle({ label, children = null }: { label: string; children?: ReactNode }) {
  const row = useContext(RowContext);
  if (!row) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={row.toggle}
      aria-expanded={row.open}
      aria-controls={row.panelId}
      title={row.open ? "Hide details" : label}
      aria-label={children ? undefined : row.open ? "Hide details" : label}
      className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-[7px] hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue"
    >
      {children}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true" className={`text-zk-muted transition-transform motion-reduce:transition-none ${row.open ? "rotate-180" : ""}`}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
