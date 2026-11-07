"use client";

import { useActionState, useRef, useState } from "react";
import { setWeeklyGoalAction, type GoalResult } from "./actions";

/** Change goal (#earnings): a small inline form on the goal card; it closes once the goal is saved. */
export function ChangeGoal({ goal }: { goal: number }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [state, save, saving] = useActionState<GoalResult, FormData>(async (prev, formData) => {
    const result = await setWeeklyGoalAction(prev, formData);
    if (result.saved) setOpen(false);
    return result;
  }, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
        className="text-sm font-semibold text-zk-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue"
      >
        Change goal
      </button>
    );
  }
  return (
    <form action={save} className="flex flex-wrap items-center justify-end gap-2">
      <label htmlFor="weekly-goal" className="sr-only">Your goal this week, in dollars</label>
      <span className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zk-muted">$</span>
        <input
          ref={input}
          id="weekly-goal"
          name="goal"
          inputMode="decimal"
          defaultValue={goal}
          className="h-9 w-28 rounded-xl border border-zk-border bg-zk-surface pl-6 pr-2 text-sm tabular-nums"
        />
      </span>
      <button type="submit" disabled={saving} className="h-9 rounded-full bg-electric-blue-strong px-4 text-sm font-bold text-white disabled:opacity-60">
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-9 px-1 text-sm text-zk-muted hover:text-zk-text">Cancel</button>
      {state.error ? <p role="alert" className="w-full text-right text-xs text-zk-bad-fg">{state.error}</p> : null}
    </form>
  );
}
