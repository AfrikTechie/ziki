import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { isTenantAdmin } from "@/lib/agents/membership";
import type { Actor } from "@/lib/agents/registry";
import { parseEscalationBody } from "@/lib/agent-questions";

/**
 * A person writing to an agent (#605). `AgentQuestion` goes agent → owner;
 * this goes the other way: "focus on desktop bugs today", "stop working on
 * #212". The owner, or an admin of the agent's tenant, sends a message; the
 * agent reads it as an inbox item of kind `message`. The owner also keeps a
 * standing brief on `Agent.instructions`, returned by `GET /api/v1/agents/me`.
 *
 * Messages are not tenant events: the feed is tenant-wide and a message is
 * meant for one agent, so the body only goes to that agent's inbox.
 */

export const AGENT_MESSAGE_MAX = 2000;
export const AGENT_INSTRUCTIONS_MAX = 4000;

export const agentMessageSchema = z.object({ body: z.string().trim().min(1).max(AGENT_MESSAGE_MAX) }).strict();

/** Blank clears the brief. */
export const agentInstructionsSchema = z
  .object({ instructions: z.string().trim().max(AGENT_INSTRUCTIONS_MAX) })
  .strict();

export type AgentMessageResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_FOUND = "That agent doesn't exist, or it isn't yours to message.";

/** The agent, and whether the actor may write to it: its owner or an admin of its tenant. */
async function writableAgent(actor: Actor, agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, tenantId: true, ownerUserId: true, revokedAt: true, instructions: true },
  });
  if (!agent) return null;
  const isOwner = agent.ownerUserId === actor.id;
  if (!isOwner && !(await isTenantAdmin(actor, agent.tenantId))) return null;
  return { agent, isOwner };
}

/** Store the message and put it in the agent's inbox in one transaction. */
export async function sendAgentMessage(
  actor: Actor & { name?: string | null },
  agentId: string,
  input: unknown,
): Promise<AgentMessageResult<{ id: string }>> {
  const parsed = agentMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Write a message of up to ${AGENT_MESSAGE_MAX} characters.` };
  const writable = await writableAgent(actor, agentId);
  if (!writable) return { ok: false, error: NOT_FOUND };
  if (writable.agent.revokedAt) return { ok: false, error: "That agent is revoked." };
  const { agent, isOwner } = writable;

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.agentMessage.create({
      data: { agentId, fromUserId: actor.id, body: parsed.data.body },
      select: { id: true, createdAt: true },
    });
    await tx.agentInboxItem.create({
      data: {
        agentId,
        kind: "message",
        eventType: "message.sent",
        payload: {
          messageId: created.id,
          agentId,
          from: { type: "user", id: actor.id, name: actor.name ?? null, role: isOwner ? "owner" : "tenant_admin" },
          body: parsed.data.body,
        },
        createdAt: created.createdAt,
      },
    });
    await audit({ agentId, tenantId: agent.tenantId }, "message.sent", created.id, { by: isOwner ? "owner" : "tenant_admin" }, {
      db: tx,
      actorUserId: actor.id,
    });
    return created;
  });
  return { ok: true, id: message.id };
}

/** Only the owner sets the standing brief. */
export async function setAgentInstructions(actor: Actor, agentId: string, input: unknown): Promise<AgentMessageResult> {
  const parsed = agentInstructionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Instructions must be ${AGENT_INSTRUCTIONS_MAX} characters or fewer.` };
  const writable = await writableAgent(actor, agentId);
  if (!writable) return { ok: false, error: NOT_FOUND };
  if (!writable.isOwner) return { ok: false, error: "Only the agent's owner can change its instructions." };
  if (writable.agent.revokedAt) return { ok: false, error: "That agent is revoked." };

  const instructions = parsed.data.instructions || null;
  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data: { instructions } });
    await audit(
      { agentId, tenantId: writable.agent.tenantId },
      "agent.instructions_changed",
      `agent:${agentId}`,
      { length: instructions?.length ?? 0 },
      { db: tx, actorUserId: actor.id },
    );
  });
  return { ok: true };
}

/** The standing brief, for `GET /api/v1/agents/me`. */
export async function readAgentInstructions(agentId: string): Promise<string | null> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { instructions: true } });
  return agent?.instructions ?? null;
}

/**
 * When the agent marks inbox items read, the messages behind them are read
 * too, so the owner sees it in the thread. `readAt` is the value just written.
 */
export async function markMessagesRead(agentId: string, readAt: Date): Promise<void> {
  const items = await prisma.agentInboxItem.findMany({
    where: { agentId, kind: "message", readAt },
    select: { payload: true },
  });
  const ids = items
    .map((item) => (item.payload as { messageId?: unknown } | null)?.messageId)
    .filter((id): id is string => typeof id === "string");
  if (!ids.length) return;
  await prisma.agentMessage.updateMany({ where: { id: { in: ids }, agentId, readAt: null }, data: { readAt } });
}

export type AgentThreadEntry =
  | {
      kind: "question";
      id: string;
      body: string;
      answer: string | null;
      answeredAt: Date | null;
      createdAt: Date;
      bug: { id: string; number: number; title: string; project: { slug: string; tenant: { slug: string } } } | null;
    }
  | {
      kind: "message";
      id: string;
      body: string;
      from: { id: string; name: string };
      readAt: Date | null;
      createdAt: Date;
    };

/**
 * One agent's conversation, oldest first: its questions and the messages
 * sent to it. Questions are addressed to the owner, so an admin who isn't
 * the owner sees the messages only. `null` when the actor may not see it.
 */
export async function listAgentThread(actor: Actor, agentId: string, take = 100) {
  const writable = await writableAgent(actor, agentId);
  if (!writable) return null;
  const [questions, messages] = await Promise.all([
    writable.isOwner
      ? prisma.agentQuestion.findMany({
          where: { agentId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          select: {
            id: true,
            body: true,
            answer: true,
            answeredAt: true,
            createdAt: true,
            bug: { select: { id: true, number: true, title: true, project: { select: { slug: true, tenant: { select: { slug: true } } } } } },
          },
        })
      : Promise.resolve([]),
    prisma.agentMessage.findMany({
      where: { agentId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: { id: true, body: true, readAt: true, createdAt: true, fromUser: { select: { id: true, name: true } } },
    }),
  ]);

  const entries: AgentThreadEntry[] = [
    ...questions.map((question) => ({
      kind: "question" as const,
      id: question.id,
      body: parseEscalationBody(question.body).cleanBody,
      answer: question.answer,
      answeredAt: question.answeredAt,
      createdAt: question.createdAt,
      bug: question.bug,
    })),
    ...messages.map((message) => ({
      kind: "message" as const,
      id: message.id,
      body: message.body,
      from: message.fromUser,
      readAt: message.readAt,
      createdAt: message.createdAt,
    })),
  ];
  entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return {
    agent: { id: writable.agent.id, name: writable.agent.name, revoked: writable.agent.revokedAt !== null },
    isOwner: writable.isOwner,
    /** The standing brief, for its owner to edit. */
    instructions: writable.isOwner ? writable.agent.instructions : null,
    entries: entries.slice(-take),
  };
}
