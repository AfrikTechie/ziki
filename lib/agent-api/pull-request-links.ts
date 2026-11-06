import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { IssueApiError } from "@/lib/agent-api/errors";
import { issueIdFor } from "@/lib/issue-ref";
import type { AgentContext } from "@/lib/agents/require-agent";
import { audit } from "@/lib/agents/audit";

/** A GitHub pull request or commit link. */
const githubLink = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull\/\d+|commit\/[0-9a-f]{7,40})\/?$/i.test(url), {
    message: "Give a GitHub pull request or commit link.",
  });

/**
 * `POST /api/v1/issues/{id}/pull-request-links` (#pr-link-repair): an agent
 * reports what an issue's old pull request link maps to. The old link is kept;
 * the verified canonical pull request or commit is attached, or the report
 * says the old repository can't be read. One of the two is required.
 */
export const pullRequestLinkRepairSchema = z
  .object({
    originalUrl: z.string().trim().url().max(500),
    canonicalUrl: githubLink.optional(),
    inaccessible: z.boolean().optional(),
    evidence: z.string().trim().min(1).max(4000),
    projectId: z.string().trim().min(1).max(191).optional(),
  })
  .strict()
  .refine((body) => Boolean(body.canonicalUrl) || body.inaccessible === true, {
    message: "Give the verified canonicalUrl, or set inaccessible when the old repository can't be read.",
    path: ["canonicalUrl"],
  });

/** The links an issue has had: its linked pull request, its deliveries' and its proof links. */
async function knownLinks(bugId: string): Promise<Set<string>> {
  const bug = await prisma.bug.findUnique({
    where: { id: bugId },
    select: { pullRequestUrl: true, proofLinks: true, deliveries: { select: { pullRequestUrl: true } } },
  });
  return new Set([bug?.pullRequestUrl, ...(bug?.proofLinks ?? []), ...(bug?.deliveries ?? []).map((d) => d.pullRequestUrl)].filter((url): url is string => Boolean(url)));
}

export async function repairPullRequestLink(agent: AgentContext, scope: { organisationId: string; projectId: string }, issueRef: string, raw: unknown) {
  const input = pullRequestLinkRepairSchema.parse(raw);
  const bugId = await issueIdFor(prisma, issueRef, scope.organisationId);
  const bug = bugId ? await prisma.bug.findFirst({ where: { id: bugId, ...scope, isDeleted: false }, select: { id: true } }) : null;
  if (!bug) throw new IssueApiError(404, "Issue not found.");
  if (!(await knownLinks(bug.id)).has(input.originalUrl)) {
    throw new IssueApiError(422, "originalUrl must be a link this issue has: its pull request, a delivery's or a proof link.");
  }
  const fields = {
    canonicalUrl: input.canonicalUrl ?? null,
    inaccessible: input.inaccessible ?? false,
    evidence: input.evidence,
    agentId: agent.agentId,
    agentName: agent.name,
    onBehalfOfUserId: agent.ownerId,
  };
  const repair = await prisma.pullRequestLinkRepair.upsert({
    where: { bugId_originalUrl: { bugId: bug.id, originalUrl: input.originalUrl } },
    create: { bugId: bug.id, originalUrl: input.originalUrl, ...fields },
    update: fields,
  });
  await audit(agent, "issue.pull_request_link_repaired", `issue:${bug.id}`, { originalUrl: input.originalUrl, canonicalUrl: fields.canonicalUrl, inaccessible: fields.inaccessible }, { bugId: bug.id });
  return { repair };
}

export async function listPullRequestLinkRepairs(scope: { organisationId: string; projectId: string }, issueRef: string) {
  const bugId = await issueIdFor(prisma, issueRef, scope.organisationId);
  const bug = bugId ? await prisma.bug.findFirst({ where: { id: bugId, ...scope, isDeleted: false }, select: { id: true } }) : null;
  if (!bug) throw new IssueApiError(404, "Issue not found.");
  const items = await prisma.pullRequestLinkRepair.findMany({ where: { bugId: bug.id }, orderBy: { updatedAt: "desc" } });
  return { items };
}
