import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { IssueApiError } from "@/lib/agent-api/errors";
import type { NotesActor } from "@/lib/project-notes";
import { activeIn } from "@/lib/agents/active-in";

/**
 * An agent's own notes on a project (#agent-notes): what it learned and wants
 * to keep for itself, apart from the shared project notes. Only the agent
 * writes them, through its key; its owner reads them on the Notes page.
 */
export const agentNoteInput = z.object({ body: z.string().trim().min(1).max(10_000) }).strict();

function agentOf(actor: NotesActor) {
  if (!actor.agent) throw new IssueApiError(403, "Personal notes belong to an agent: use an agent key.");
  return actor.agent.agentId;
}

/** The agent's notes on this project, newest first. */
export async function listAgentNotes(actor: NotesActor) {
  const agentId = agentOf(actor);
  const items = await prisma.agentNote.findMany({
    where: { agentId, projectId: actor.projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return { items };
}

export async function addAgentNote(actor: NotesActor, input: unknown) {
  const agentId = agentOf(actor);
  const { body } = agentNoteInput.parse(input);
  const note = await prisma.agentNote.create({ data: { organisationId: actor.organisationId, projectId: actor.projectId, agentId, body } });
  return { note };
}

/** Rewrites one of the agent's notes, when what it learned has changed. */
export async function editAgentNote(actor: NotesActor, noteId: string, input: unknown) {
  const agentId = agentOf(actor);
  const { body } = agentNoteInput.parse(input);
  const found = await prisma.agentNote.findFirst({ where: { id: noteId, agentId, projectId: actor.projectId }, select: { id: true } });
  if (!found) throw new IssueApiError(404, "Note not found.");
  return { note: await prisma.agentNote.update({ where: { id: noteId }, data: { body } }) };
}

export async function deleteAgentNote(actor: NotesActor, noteId: string) {
  const agentId = agentOf(actor);
  const { count } = await prisma.agentNote.deleteMany({ where: { id: noteId, agentId, projectId: actor.projectId } });
  if (!count) throw new IssueApiError(404, "Note not found.");
  return { deleted: true };
}

/** The person's agents in this organisation, for the Notes sidebar, with how many notes each keeps on the project. */
export async function ownAgentsWithNotes(userId: string, organisationId: string, projectId: string) {
  const agents = await prisma.agent.findMany({
    where: { ownerUserId: userId, ...activeIn(organisationId), revokedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, _count: { select: { agentNotes: { where: { projectId } } } } },
  });
  return agents.map((agent) => ({ id: agent.id, name: agent.name, notes: agent._count.agentNotes }));
}
