import type React from "react";
import Link from "next/link";

/**
 * The stages of the work across the top of the Issues page, on one row: Your
 * Work (only while you have any), Ideas, In Progress, Delivered and Live (only
 * once something went live), each with its count. The picked stage is filled in;
 * its statuses are listed down the left of the panel.
 *
 * On a phone they are plain tabs: equal columns, a long label on two lines with
 * its count under it, no dot, and a thin underline that is thick on the picked one.
 */
export type PipelineStage = { label: string; count: number; href: string; selected: boolean };

export function PipelineSteps({ stages }: { stages: PipelineStage[] }) {
  return (
    // One row whatever the number of stages (Your Work and Live come and go): a column each, about 133px wide.
    <nav
      aria-label="Stages"
      className="grid w-full grid-cols-[repeat(var(--stages),minmax(0,1fr))] gap-x-1.5 max-sm:gap-x-0 max-sm:border-b max-sm:border-zk-border"
      style={{ "--stages": stages.length, maxWidth: stages.length * 133 } as React.CSSProperties}
    >
      {stages.map((stage) => (
        <Link
          key={stage.label}
          href={stage.href}
          aria-current={stage.selected ? "page" : undefined}
          className="group flex flex-col items-center gap-1.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent max-sm:min-h-11 max-sm:justify-end max-sm:gap-1.5 max-sm:pb-0 max-sm:rounded-none max-sm:px-0.5"
        >
          <span
            className={`flex items-center gap-1 whitespace-nowrap text-xs max-sm:flex-col max-sm:gap-0 max-sm:whitespace-normal max-sm:text-center max-sm:text-[13px] max-sm:leading-[1.2] ${
              stage.selected ? "font-bold text-zk-text" : "font-medium text-zk-text2 group-hover:text-zk-text"
            }`}
          >
            {stage.label}
            {/* The same face as the label on a phone, so the two lines read as one tab. */}
            <span className={`font-mono text-[11px] font-medium tabular-nums text-zk-muted max-sm:mt-0.5 max-sm:font-sans max-sm:text-[12px] ${stage.selected ? "max-sm:font-semibold max-sm:text-zk-accent" : ""}`}>{stage.count}</span>
          </span>
          {/* The dot is for the wide layout; a phone shows tabs. */}
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full max-sm:hidden ${stage.selected ? "bg-electric-blue-strong" : "bg-electric-blue-strong/15"}`} />
          <span
            aria-hidden="true"
            className={`h-2 w-full rounded-full max-sm:-mb-px max-sm:rounded-none ${
              stage.selected
                ? "bg-electric-blue-strong max-sm:h-[3px]"
                : "bg-electric-blue-strong/15 group-hover:bg-electric-blue-strong/30 max-sm:h-0 max-sm:bg-transparent"
            }`}
          />
        </Link>
      ))}
    </nav>
  );
}
