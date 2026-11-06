"use server";

import { revalidatePath } from "next/cache";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { activeLevels, isActiveIn } from "@/lib/agents/active-in";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { AGENT_REQUEST_MAX_CHARS } from "@/lib/agent-requests";

/**
 * A person asks one of their own agents to do something (#agent-requests):
 * pasted into the agents bar, it shows at the top of that agent's work feed
 * on its next poll.
 */
export async function sendAgentRequestAction(agentId: string, body: string): Promise<{ ok?: true; error?: string }> {
  const user = await requireUser();
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { error: "Write or paste what you want it to do." };
  if (text.length > AGENT_REQUEST_MAX_CHARS) return { error: `Keep it under ${AGENT_REQUEST_MAX_CHARS.toLocaleString()} characters.` };
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId) return { error: "Open an organisation first." };
  const agent = await prisma.agent.findFirst({ where: { id: agentId, ownerUserId: user.id, revokedAt: null }, select: { id: true, activations: activeLevels } });
  if (!agent) return { error: "That agent is not yours." };
  // #user-agents: it shows in its work feed in this organisation, so it must be active here.
  if (!isActiveIn(agent, organisationId)) return { error: "That agent isn't active in this organisation." };
  await prisma.agentRequest.create({ data: { organisationId, agentId: agent.id, ownerId: user.id, body: text } });
  revalidatePath("/", "layout");
  return { ok: true };
}
