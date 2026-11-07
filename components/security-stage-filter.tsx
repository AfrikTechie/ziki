import Link from "next/link";
import type { DashboardFinding } from "@/lib/security-dashboard";

export const SECURITY_STAGE_FILTERS = [
  { value: "all", label: "All" },
  { value: "reported", label: "Reported" },
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "merge", label: "Merge" },
  { value: "live", label: "Live" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
] as const;

export type SecurityStageFilter = (typeof SECURITY_STAGE_FILTERS)[number]["value"];

const STAGES_BY_FILTER: Record<SecurityStageFilter, readonly string[] | null> = {
  all: null,
  reported: ["Reported", "Waiting for verdicts"],
  open: ["Requires confirmation", "Open"],
  "in-progress": ["Plan review", "In progress"],
  done: ["Requires review", "Accepted"],
  merge: ["Ready to merge", "Error"],
  live: ["On dev", "On staging", "On prod", "Published"],
  closed: ["Closed"],
  rejected: ["Rejected"],
  archived: ["Archived"],
};

export function parseSecurityStageFilter(value: string | string[] | undefined): SecurityStageFilter {
  if (typeof value !== "string") return "all";
  return SECURITY_STAGE_FILTERS.find((filter) => filter.value === value)?.value ?? "all";
}

export function filterSecurityFindingsByStage<T extends Pick<DashboardFinding, "stage">>(
  findings: readonly T[],
  selected: SecurityStageFilter,
): T[] {
  const stages = STAGES_BY_FILTER[selected];
  return stages ? findings.filter((finding) => stages.includes(finding.stage)) : [...findings];
}

export function SecurityStageFilterBar({
  findings,
  selected,
  severity,
}: {
  findings: readonly Pick<DashboardFinding, "stage">[];
  selected: SecurityStageFilter;
  severity?: string;
}) {
  const counts: Record<SecurityStageFilter, number> = {
    all: findings.length,
    reported: 0,
    open: 0,
    "in-progress": 0,
    done: 0,
    merge: 0,
    live: 0,
    closed: 0,
    rejected: 0,
    archived: 0,
  };

  for (const filter of SECURITY_STAGE_FILTERS) {
    if (filter.value !== "all") {
      counts[filter.value] = filterSecurityFindingsByStage(findings, filter.value).length;
    }
  }

  return (
    <nav aria-label="Filter open findings by workflow stage" className="flex flex-wrap gap-2">
      {SECURITY_STAGE_FILTERS.map((filter) => {
        const active = selected === filter.value;
        const params = new URLSearchParams();
        if (filter.value !== "all") params.set("stage", filter.value);
        if (severity && severity !== "all") params.set("severity", severity);
        const query = params.toString();
        const href = query ? `/security?${query}` : "/security";
        return (
          <Link
            key={filter.value}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={`${filter.label}: ${counts[filter.value]} open ${counts[filter.value] === 1 ? "finding" : "findings"}`}
            className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 ${
              active
                ? "border-zk-accent bg-zk-tint text-zk-accent"
                : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-bg"
            }`}
          >
            <span>{filter.label}</span>
            <span className="tabular-nums">{counts[filter.value]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
