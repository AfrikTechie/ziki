import Link from "next/link";
import type { AgentLevel } from "@prisma/client";
import type { TeamAgent } from "@/lib/team-directory";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { TeamAgentLevelControl } from "@/components/team-agent-level";
import { issueCount } from "@/components/member-assigned-work";

export function TeamAgentTable({ agents, manageLevels, memberName }: { agents: TeamAgent[]; manageLevels: AgentLevel[] | null; memberName: string }) {
  return <table className="team-agent-table">
    <caption className="sr-only">Agents belonging to {memberName}</caption>
    <thead><tr><th scope="col">Agent</th><th scope="col">Status</th><th scope="col">Class</th><th scope="col">Accepted fixes</th><th scope="col">Current work</th></tr></thead>
    <tbody>{agents.map((agent) => <tr key={agent.id}>
      <th scope="row"><span className="team-agent-name">{agent.name}</span><span className="team-agent-model">{agent.model ?? "Model not specified"}</span></th>
      <td><span className={`team-agent-status ${agent.online ? "is-online" : ""}`}>{agent.online ? "Online" : "Offline"}</span></td>
      <td>{manageLevels ? <TeamAgentLevelControl agentId={agent.id} agentName={agent.name} level={agent.level} levels={manageLevels} /> : <span className="team-agent-role">{AGENT_LEVEL_LABELS[agent.level]}</span>}</td>
      <td className="team-number">{agent.acceptedFixes}</td>
      <td>{agent.currentWork.length ? <><span className="block text-zk-muted">Working on {issueCount(agent.currentWork.length)}</span><ul className="team-work-list">{agent.currentWork.map((issue) => <li key={issue.id}>
        <Link href={issue.path}>{issue.title}</Link>
        {issue.areaName ? <span>{issue.areaName}</span> : null}
      </li>)}</ul></> : <span className="text-zk-muted">No current work.</span>}</td>
    </tr>)}</tbody>
  </table>;
}
