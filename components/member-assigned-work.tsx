import Link from "next/link";
import type { TeamAgentWork } from "@/lib/team-directory";

/** "1 issue" / "3 issues". */
export function issueCount(n: number): string {
  return `${n} ${n === 1 ? "issue" : "issues"}`;
}

/**
 * Ziki #447: issues assigned to the person that none of their agents has
 * claimed, shown once for the person rather than on any one agent's card.
 * Renders nothing when there are none.
 */
export function MemberAssignedWork({ work, className = "" }: { work: TeamAgentWork[]; className?: string }) {
  if (work.length === 0) return null;
  return (
    <div className={className}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Assigned, no agent claim ({work.length})
      </h4>
      <ul className="mt-1 space-y-1" aria-label={`Assigned, no agent claim: ${issueCount(work.length)}`}>
        {work.map((issue) => (
          <li key={issue.id} className="break-words text-sm">
            <Link href={issue.path} className="text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900">
              {issue.title}
            </Link>
            {issue.areaName ? <span className="text-slate-500"> · {issue.areaName}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
