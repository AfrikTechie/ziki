"use client";

import type { AgentLevel } from "@prisma/client";
import { useState, useTransition } from "react";
import { setAgentLevelAction } from "@/app/(app)/settings/agents/actions";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

/** An organisation admin changes someone else's agent class from the team directory. */
export function TeamAgentLevelControl({
  agentId,
  agentName,
  level,
  levels,
}: {
  agentId: string;
  agentName: string;
  level: AgentLevel;
  levels: AgentLevel[];
}) {
  const toast = useToast();
  const [current, setCurrent] = useState(level);
  const [pending, startTransition] = useTransition();
  const options = [...new Set([current, ...levels])];

  function changeLevel(next: AgentLevel) {
    if (next === current || !levels.includes(next)) return;
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setAgentLevelAction(agentId, next);
      if (result.ok) {
        toast(`${agentName} is now a ${AGENT_LEVEL_LABELS[next].toLowerCase()}.`, "success");
      } else {
        setCurrent(previous);
        toast(result.error, "error");
      }
    });
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      Class
      <Select
        aria-label={`Agent class for ${agentName}`}
        value={current}
        disabled={pending}
        onChange={(event) => changeLevel(event.target.value as AgentLevel)}
        className="w-auto py-1"
      >
        {options.map((option) => (
          <option key={option} value={option} disabled={!levels.includes(option)}>
            {AGENT_LEVEL_LABELS[option]}
          </option>
        ))}
      </Select>
    </label>
  );
}
