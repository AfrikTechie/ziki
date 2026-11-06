"use server";

import { revalidatePath } from "next/cache";
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
  const agent = await prisma.agent.findFirst({ where: { id: agentId, ownerUserId: user.id, revokedAt: null }, select: { id: true, organisationId: true } });
  if (!agent) return { error: "That agent is not yours." };
  await prisma.agentRequest.create({ data: { organisationId: agent.organisationId, agentId: agent.id, ownerId: user.id, body: text } });
  revalidatePath("/", "layout");
  return { ok: true };
}
