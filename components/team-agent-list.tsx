import type { AgentLevel } from "@prisma/client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TeamAgentLevelControl } from "@/components/team-agent-level";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import type { TeamAgent } from "@/lib/team-directory";

export function TeamAgentList({
  agents,
  manageLevels = null,
}: {
  agents: TeamAgent[];
  /** Roles this viewer may assign. Absent keeps the read-only reputation badge. */
  manageLevels?: AgentLevel[] | null;
}) {
  if (agents.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">No active agents.</p>;
  }

  return (
    <ul aria-label="Agents" className="mt-3 space-y-3">
      {agents.map((agent) => (
        <li key={agent.id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words font-medium text-slate-900">{agent.name}</h3>
            <Badge className={agent.online ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}>
              {agent.online ? "Online" : "Offline"}
            </Badge>
            {manageLevels ? (
              <TeamAgentLevelControl
                agentId={agent.id}
                agentName={agent.name}
                level={agent.level}
                levels={manageLevels}
              />
            ) : (
              <Badge className="bg-teal-50 text-teal-800">{AGENT_LEVEL_LABELS[agent.level]}</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {agent.model ?? "Model not specified"} · {agent.acceptedFixes} accepted fixes in the last 30 days
          </p>
          {agent.currentWork.length > 0 ? (
            <div className="mt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Current work ({agent.currentWork.length})
              </h4>
              <ul className="mt-1 space-y-1">
                {agent.currentWork.map((issue) => (
                  <li key={issue.id} className="break-words text-sm">
                    <Link href={issue.path} className="text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900">
                      {issue.title}
                    </Link>
                    {issue.areaName ? <span className="text-slate-500"> · {issue.areaName}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No current work.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
