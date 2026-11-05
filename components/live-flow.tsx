import type { Substatus } from "@prisma/client";
import { LocalTime } from "@/components/local-time";

type LiveSubstatus = Extract<Substatus, "on_dev" | "on_staging" | "on_prod">;

const STEPS: { substatus: LiveSubstatus; label: string }[] = [
  { substatus: "on_dev", label: "On dev" },
  { substatus: "on_staging", label: "On staging" },
  { substatus: "on_prod", label: "On prod" },
];

/**
 * Where a Live issue is on its way to users (#live-confirm), in the Status box:
 * the three Live statuses Ziki already has, each ticked once reached, with when.
 * On prod shows how many agents have found it there; it is reached once enough have.
 */
export function LiveFlow({ substatus, reachedAt, confirmed, needed }: {
  substatus: Substatus;
  /** When the issue last moved to each Live status, from its activity. */
  reachedAt: Partial<Record<LiveSubstatus, Date>>;
  confirmed: number;
  needed: number;
}) {
  const current = STEPS.findIndex((step) => step.substatus === substatus);
  if (current < 0) return null;
  return (
    <ol data-testid="live-flow" aria-label="On its way to users" className="m-0 mt-0.5 flex list-none flex-col p-0">
      {STEPS.map((step, index) => {
        const state = index < current ? "done" : index === current ? "now" : "next";
        const last = index === STEPS.length - 1;
        const at = index <= current ? reachedAt[step.substatus] : undefined;
        return (
          <li key={step.substatus} data-state={state} aria-current={state === "now" ? "step" : undefined} className="relative flex gap-2.5 pb-3 last:pb-0">
            {/* The line down to the next step: solid once that step is reached. */}
            {!last ? (
              <span aria-hidden className={`absolute left-[7px] top-4 h-[calc(100%-12px)] w-0.5 rounded ${index < current ? "bg-zk-ok-fg" : "bg-zk-border"}`} />
            ) : null}
            <span aria-hidden className={`relative mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
              state === "next" ? "border-2 border-zk-border bg-zk-surface" : state === "now" && (!last || confirmed < needed) ? "border-2 border-zk-ok-fg bg-zk-surface" : "bg-zk-ok-fg text-white"
            }`}>
              {state === "done" || (state === "now" && last && confirmed >= needed) ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              ) : state === "now" ? <span className="size-1.5 rounded-full bg-zk-ok-fg" /> : null}
            </span>
            <span className="flex min-w-0 flex-col text-xs leading-4">
              <span className={state === "next" ? "font-semibold text-zk-muted" : "font-bold text-zk-text"}>
                {step.label}
                {state === "now" && !last ? <span className="font-semibold text-zk-ok-fg"> (now)</span> : null}
              </span>
              {at ? <LocalTime date={at} className="text-zk-muted" /> : null}
              {/* Until enough agents agree, even an issue marked On prod (before #live-confirm) says how many have. */}
              {last && (state !== "now" || confirmed < needed) ? (
                <span className="mt-0.5 inline-flex items-center gap-1.5 text-zk-text2">
                  <span className="inline-flex gap-0.5" aria-hidden>
                    {Array.from({ length: needed }, (_, dot) => (
                      <span key={dot} className={`size-1.5 rounded-full ${dot < confirmed ? "bg-zk-ok-fg" : "border border-zk-muted"}`} />
                    ))}
                  </span>
                  {Math.min(confirmed, needed)} of {needed} agents found it here{state === "now" ? ", marked before the rule" : ""}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
