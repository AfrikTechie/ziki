"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearDuplicateAction,
  findDuplicateCandidatesAction,
  markDuplicateAction,
  type DuplicateCandidate,
} from "@/app/actions/duplicates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatIssueNumber } from "@/lib/issue-number";
import { statusLabels } from "@/lib/labels";

/**
 * Admin control (#285): pick the issue this one duplicates. Type a number
 * (#12) or words from its title; pressing Enter on a number marks it
 * straight away.
 */
export function MarkDuplicateButton({
  bugId,
  label = "Mark as duplicate",
}: {
  bugId: string;
  label?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DuplicateCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const listId = useId();

  useEffect(() => {
    if (!open || !query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await findDuplicateCandidatesAction(bugId, query);
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bugId, open, query]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setError(null);
    if (restoreFocus) {
      wrapperRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        close(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  const choose = (ref: string) => {
    setError(null);
    startTransition(async () => {
      const result = await markDuplicateAction(bugId, ref);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast("Marked as a duplicate. It's now hidden from the issues list.");
      close(true);
      router.refresh();
    });
  };

  const shown = query.trim() ? results : [];

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        type="button"
        variant="secondary"
        className="cursor-pointer px-2.5 py-1.5 text-xs"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {label}
      </Button>
      {open ? (
        // Escape is handled on the panel, not the input, so it also closes
        // while a suggestion in the list is highlighted.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          id={panelId}
          role="group"
          aria-label="Mark as duplicate"
          className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-zk-border bg-zk-surface p-3 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <label htmlFor={`${panelId}-q`} className="block text-xs font-medium text-zk-text2">
            Duplicate of which issue?
          </label>
          <Input
            // Focus the search field the user just opened, like the confirm
            // dialog does.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            id={`${panelId}-q`}
            className="mt-1"
            placeholder="#12, or words from its title"
            value={query}
            aria-controls={listId}
            onChange={(event) => {
              setError(null);
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (/^#?\d+$/.test(query.trim())) choose(query);
                else if (shown.length === 1) choose(shown[0].id);
              }
            }}
          />
          {error ? (
            <p className="mt-2 text-xs text-zk-bad-fg" role="alert">
              {error}
            </p>
          ) : null}
          <ul id={listId} className="mt-2 max-h-64 space-y-1 overflow-y-auto" aria-label="Matching issues">
            {shown.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => choose(issue.id)}
                  className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zk-chip focus-visible:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-zk-muted tabular-nums">{formatIssueNumber(issue.number)}</span>{" "}
                  <span className="text-zk-text">{issue.title}</span>
                  <span className="ml-1 text-xs text-zk-muted">· {statusLabels[issue.status]}</span>
                </button>
              </li>
            ))}
          </ul>
          {query.trim() && shown.length === 0 && !error ? (
            <p className="mt-2 text-xs text-zk-muted">
              No match yet. Issues that are already duplicates aren&apos;t offered.
            </p>
          ) : null}
          <p className="mt-2 text-xs text-zk-muted">
            Importance stays on each issue; it isn&apos;t merged.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Admin control (#285): unlink, so the issue shows in the list again. */
export function ClearDuplicateButton({ bugId }: { bugId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      className="cursor-pointer px-2.5 py-1 text-xs"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await clearDuplicateAction(bugId);
          if (result.error) {
            toast(result.error, "error");
            return;
          }
          toast("No longer a duplicate. It's back in the issues list.");
          router.refresh();
        })
      }
    >
      {pending ? "Clearing…" : "Not a duplicate"}
    </Button>
  );
}
