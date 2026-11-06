import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { audit } from "@/lib/agents/audit";
import { publish } from "@/lib/agent-api/events";
import { createJobSchema, type CreateJobInput } from "@/lib/validations/job";

/**
 * Creating a research job (#617). Additive: nothing here touches the bug flow.
 */

type Db = typeof prisma | Prisma.TransactionClient;

export type JobRecord = Prisma.JobGetPayload<Record<string, never>>;

const jobSelect = {
  id: true,
  organisationId: true,
  projectId: true,
  createdById: true,
  brief: true,
  submissionSchema: true,
  dedupeKey: true,
  maxSubmissions: true,
  pointsPerAccepted: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.JobSelect;

/** Creates a job in `projectId` on behalf of the calling agent (#617). */
export async function createJob(agent: AgentContext, input: CreateJobInput): Promise<JobRecord> {
  const parsed = createJobSchema.parse(input);
  const { projectId, ...fields } = parsed;

  const project = await prisma.project.findFirst({
    where: { organisationId: agent.organisationId, ...(projectId ? { id: projectId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, organisationId: true },
  });
  if (!project) throw new IssueApiError(404, "Project not found.");

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        organisationId: project.organisationId,
        projectId: project.id,
        createdById: agent.ownerId,
        brief: fields.brief,
        submissionSchema: (fields.submissionSchema ?? null) as Prisma.InputJsonValue,
        dedupeKey: fields.dedupeKey,
        maxSubmissions: fields.maxSubmissions,
        pointsPerAccepted: fields.pointsPerAccepted,
      },
      select: jobSelect,
    });

    await audit(agent, "job.created", job.id, { projectId: project.id }, { db: tx });
    await publish(tx, {
      organisationId: project.organisationId,
      type: "job.created",
      actorAgentId: agent.agentId,
      payload: {
        jobId: job.id,
        projectId: project.id,
        dedupeKey: job.dedupeKey,
        maxSubmissions: job.maxSubmissions,
        pointsPerAccepted: Number(job.pointsPerAccepted),
      },
    });
    return job;
  });
}

/** Lists a project's jobs, newest first (#617). */
/** `take: null` lists every job (the work feed has no cap). */
export async function listJobs(organisationId: string, projectId: string, take: number | null = 50) {
  return prisma.job.findMany({
    where: { organisationId, projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take ?? undefined,
    select: jobSelect,
  });
}

/** Loads a job scoped to the organisation, enforcing the key's project (#617). */
export async function readJob(agent: AgentContext, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, organisationId: agent.organisationId },
    select: jobSelect,
  });
  if (!job) throw new IssueApiError(404, "Job not found.");
  return job;
}

export async function loadJob(db: Db, organisationId: string, jobId: string) {
  return db.job.findFirst({ where: { id: jobId, organisationId }, select: jobSelect });
}
