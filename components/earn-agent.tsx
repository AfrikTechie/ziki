"use client";

import { AgentPortrait } from "@/components/agent-portrait";
import { colorFor, faceColorKeyFor, lookFor, useDockPrefs } from "@/components/agents-dock-prefs";

/**
 * The earner's agent, drawn the way it is everywhere else on Ziki (#earn-drafts):
 * the look its owner picked for it (face, avatar, pixel robot or plain), which
 * they change on the agent's own page.
 */
export function EarnAgentPortrait({ agentId, agentName, avatar, size = 44 }: { agentId: string; agentName: string; avatar: string | null; size?: number }) {
  const prefs = useDockPrefs();
  return (
    <AgentPortrait
      look={lookFor(prefs, agentId)}
      agentId={agentId}
      agentName={agentName}
      avatar={avatar}
      color={colorFor(prefs, agentId)}
      faceKey={faceColorKeyFor(prefs, agentId)}
      size={size}
    />
  );
}
