import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { hasLevel, requireLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { publish } from "@/lib/agent-api/events";
import type { MistakeCategory } from "@prisma/client";

export const mistakeCategorySchema = z.enum([
  "correctness",
  "efficiency",
  "completeness",
  "mergeability",
  "architecture",
  "security",
]);

export const recordMistakeSchema = z.object({
  category: mistakeCategorySchema.default("correctness"),
  title: z.string().trim().min(3, "Title must be at least 3 characters.").max(256),
  antiPattern: z.string().trim().min(10, "Describe the mistake / anti-pattern (at least 10 characters).").max(4000),
  remediation: z.string().trim().min(10, "Describe how to avoid or correct this mistake (at least 10 characters).").max(4000),
  badCodeSnippet: z.string().trim().max(4000).optional(),
  goodCodeSnippet: z.string().trim().max(4000).optional(),
  bugId: z.string().trim().min(1).optional(),
});

export type RecordMistakeInput = z.infer<typeof recordMistakeSchema>;

export type AgentMistakeItem = {
  id: string;
  projectId: string;
  bugId: string | null;
  category: MistakeCategory;
  title: string;
  antiPattern: string;
  remediation: string;
  badCodeSnippet: string | null;
  goodCodeSnippet: string | null;
  recurrenceCount: number;
  mergerAgentId: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Record a mistake or anti-pattern discovered during review or merge.
 * Requires a manager or merger agent.
 */
export async function recordMistake(
  agent: AgentContext,
  projectId: string,
  rawInput: unknown,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ ok: true; mistake: AgentMistakeItem }> {
  if (!hasLevel(agent.level, "manager")) {
    throw new Error("Only merger agents can record anti-patterns in the mistake registry.");
  }

  const parsed = recordMistakeSchema.parse(rawInput);

  const project = await db.project.findFirst({
    where: { id: projectId, organisationId: agent.organisationId },
    select: { id: true },
  });
  if (!project) {
    throw new Error("Project not found in this organisation.");
  }

  // Check if identical title exists in project to increment recurrence
  const existing = await db.agentMistake.findFirst({
    where: {
      projectId,
      organisationId: agent.organisationId,
      title: parsed.title,
    },
  });

  let mistake;
  if (existing) {
    mistake = await db.agentMistake.update({
      where: { id: existing.id },
      data: {
        recurrenceCount: { increment: 1 },
        antiPattern: parsed.antiPattern,
        remediation: parsed.remediation,
        badCodeSnippet: parsed.badCodeSnippet ?? existing.badCodeSnippet,
        goodCodeSnippet: parsed.goodCodeSnippet ?? existing.goodCodeSnippet,
        bugId: parsed.bugId ?? existing.bugId,
      },
    });
  } else {
    mistake = await db.agentMistake.create({
      data: {
        organisationId: agent.organisationId,
        projectId,
        mergerAgentId: agent.agentId,
        bugId: parsed.bugId ?? null,
        category: parsed.category,
        title: parsed.title,
        antiPattern: parsed.antiPattern,
        remediation: parsed.remediation,
        badCodeSnippet: parsed.badCodeSnippet ?? null,
        goodCodeSnippet: parsed.goodCodeSnippet ?? null,
      },
    });
  }

  const payload = {
    mistakeId: mistake.id,
    projectId,
    title: mistake.title,
    category: mistake.category,
    recurrenceCount: mistake.recurrenceCount,
  };

  await publish(db, {
    organisationId: agent.organisationId,
    type: "project.mistake_recorded",
    payload,
    actorAgentId: agent.agentId,
    bugId: parsed.bugId ?? null,
  });

  await audit(agent, "project.mistake_recorded", `mistake:${mistake.id}`, payload, {
    bugId: parsed.bugId ?? null,
    db,
  });

  return { ok: true, mistake };
}

/**
 * List mistakes and anti-patterns for a project.
 * Open to any agent (observer capability).
 */
export async function listProjectMistakes(
  agent: AgentContext,
  projectId: string,
  options: { category?: MistakeCategory; limit?: number } = {},
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AgentMistakeItem[]> {
  requireLevel(agent, "working");

  const project = await db.project.findFirst({
    where: { id: projectId, organisationId: agent.organisationId },
    select: { id: true },
  });
  if (!project) {
    throw new Error("Project not found in this organisation.");
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  return db.agentMistake.findMany({
    where: {
      organisationId: agent.organisationId,
      projectId,
      ...(options.category ? { category: options.category } : {}),
    },
    take: limit,
    orderBy: [{ recurrenceCount: "desc" }, { createdAt: "desc" }],
  });
}
