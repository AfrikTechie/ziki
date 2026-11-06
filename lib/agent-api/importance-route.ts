import { NextResponse, type NextRequest } from "next/server";
import type { AgentContext } from "@/lib/agents/require-agent";
import { issueProject, IssueApiError } from "@/lib/agent-api/issues";
import { importanceSchema, removeUpvote, upvoteIssue } from "@/lib/agent-api/votes";
import { issueIdFor } from "@/lib/issue-ref";
import { prisma } from "@/lib/prisma";

/**
 * The handlers behind `POST/DELETE /api/v1/issues/{id}/importance` (#importance):
 * a plain toggle, no reason.
 */

/** The issue's id from the path: the readable number (`123`, `ZE-123`) or the id (#457). */
async function issueId(agent: AgentContext, issueRef: string): Promise<string> {
  const id = await issueIdFor(prisma, issueRef, agent.organisationId);
  if (!id) throw new IssueApiError(404, "Issue not found.");
  return id;
}

async function readProject(request: NextRequest): Promise<string | undefined> {
  const text = await request.text();
  if (!text.trim()) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new IssueApiError(400, "Send a valid JSON body.");
  }
  const parsed = importanceSchema.safeParse(body);
  if (!parsed.success) throw new IssueApiError(400, "Marking an issue important takes no body beyond projectId.");
  return parsed.data.projectId;
}

/** POST: marks the issue important for the agent's owner. */
export async function markImportanceResponse(agent: AgentContext, request: NextRequest, issueRef: string): Promise<Response> {
  const scope = await issueProject(agent, request.nextUrl.searchParams, await readProject(request));
  const result = await upvoteIssue(agent, scope.projectId, await issueId(agent, issueRef));
  return NextResponse.json(
    {
      important: result.important,
      importance: result.importance,
      changed: result.changed,
      weight: result.weight,
      userId: agent.ownerId,
      agentId: agent.agentId,
    },
    { status: result.changed ? 201 : 200 },
  );
}

/** DELETE: removes the owner's mark. */
export async function removeImportanceResponse(agent: AgentContext, request: NextRequest, issueRef: string): Promise<Response> {
  const scope = await issueProject(agent, request.nextUrl.searchParams, await readProject(request));
  const result = await removeUpvote(agent, scope.projectId, await issueId(agent, issueRef));
  return NextResponse.json({
    important: result.important,
    importance: result.importance,
    changed: result.changed,
    userId: agent.ownerId,
  });
}
