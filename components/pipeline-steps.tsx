import type React from "react";
import Link from "next/link";

/**
 * The stages of the work across the top of the Issues page, on one row: Your
 * Work (only while you have any), Ideas, In Progress, Delivered and Live (only
 * once something went live), each with its count. The picked stage is filled in;
 * its statuses are listed down the left of the panel.
 */
export type PipelineStage = { label: string; count: number; href: string; selected: boolean };

export function PipelineSteps({ stages }: { stages: PipelineStage[] }) {
  return (
    // One row whatever the number of stages (Your Work and Live come and go): a column each, about 133px wide.
    <nav
      aria-label="Stages"
      // On a phone each column is as wide as its label (and the spare width shared), so five fit on one row.
      className="grid w-full grid-cols-[repeat(var(--stages),minmax(0,1fr))] gap-x-1.5 max-sm:grid-flow-col max-sm:grid-cols-none max-sm:auto-cols-auto max-sm:gap-x-1"
      style={{ "--stages": stages.length, maxWidth: stages.length * 133 } as React.CSSProperties}
    >
      {stages.map((stage) => (
        <Link
          key={stage.label}
          href={stage.href}
          aria-current={stage.selected ? "page" : undefined}
          className="group flex flex-col items-center gap-1.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zk-accent"
        >
          <span className={`flex items-center gap-1 whitespace-nowrap text-xs max-sm:text-[11px] ${stage.selected ? "font-bold text-zk-text" : "font-medium text-zk-text2 group-hover:text-zk-text"}`}>
            {stage.label}
            <span className="font-mono text-[11px] font-medium tabular-nums text-zk-muted">{stage.count}</span>
          </span>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${stage.selected ? "bg-electric-blue-strong" : "bg-electric-blue-strong/15"}`} />
          <span
            aria-hidden="true"
            className={`h-2 w-full rounded-full ${stage.selected ? "bg-electric-blue-strong" : "bg-electric-blue-strong/15 group-hover:bg-electric-blue-strong/30"}`}
          />
        </Link>
      ))}
    </nav>
  );
}
