"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IDEA_AUTHOR_PARAM, parseIdeaAuthorFilter } from "@/lib/idea-filters";

const control =
  "h-8 w-full rounded-lg border border-zk-border bg-zk-surface px-2 text-[13px] text-zk-text focus:border-electric-blue-strong focus:outline-none";

/**
 * The small widget beside the Ideas status filters: opens more filters for the
 * list (who wrote it, only mine) and a link to the drafts.
 * The table clips what overflows it, so the panel is placed on the page itself.
 */
export function IdeasMoreFilters({ draftsHref }: { draftsHref: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  const author = parseIdeaAuthorFilter(searchParams.get(IDEA_AUTHOR_PARAM)) ?? "";
  const mine = searchParams.get("mine") === "created";
  const activeCount = [author, mine ? "mine" : ""].filter(Boolean).length;

  function place() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearAll() {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of [IDEA_AUTHOR_PARAM, "mine", "page"]) next.delete(key);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!open) place();
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={activeCount ? `More filters (${activeCount} on)` : "More filters"}
        title="More filters"
        className={`relative inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[7px] border px-[5px] font-mono text-[10px] font-semibold shadow-[0_1px_1px_rgba(11,23,51,0.08)] transition-colors active:translate-y-px active:shadow-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-electric-blue ${
          open || activeCount ? "border-blue-300 bg-blue-50 text-blue-700" : "border-zk-border bg-zk-surface text-zk-text2 hover:border-zk-muted hover:bg-zk-chip hover:text-zk-text"
        }`}
      >
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
        {activeCount ? <span className="tabular-nums">{activeCount}</span> : null}
      </button>

      {open && position ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="More filters"
          style={{ position: "fixed", top: position.top, right: position.right }}
          className="z-50 flex w-64 flex-col gap-3 rounded-2xl border border-zk-border bg-zk-surface p-4 text-left font-sans normal-case shadow-[0_16px_40px_rgba(11,23,51,0.18)]"
        >
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-zk-text2">
            Written by
            <select className={control} value={author} onChange={(event) => update(IDEA_AUTHOR_PARAM, event.target.value)}>
              <option value="">Anyone</option>
              <option value="people">People</option>
              <option value="agents">Agents</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-[13px] text-zk-text">
            <input type="checkbox" checked={mine} onChange={(event) => update("mine", event.target.checked ? "created" : "")} className="h-4 w-4 accent-[var(--zk-accent)]" />
            Only my ideas
          </label>

          <div className="flex items-center justify-between border-t border-zk-divider pt-3 text-[12px]">
            <Link href={draftsHref} className="font-semibold text-zk-accent hover:underline" onClick={() => setOpen(false)}>
              Drafts
            </Link>
            <button type="button" onClick={clearAll} disabled={!activeCount} className="font-semibold text-zk-text2 hover:text-zk-text disabled:opacity-40">
              Clear filters
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
