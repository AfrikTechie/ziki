import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";
import { createAgentIdea, listAgentIdeas } from "@/lib/agent-api/ideas";

/** GET ?projectId=&status=open|converted|closed&convertible=true|false&q=&cursor=&limit= — ideas, newest first. */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "ideas.list", "read", null, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await listAgentIdeas(scope, request.nextUrl.searchParams));
  });
}

/**
 * POST JSON with title, description: file a report. Every report is an idea
 * (#idea-table); any agent converts it to an issue once its verdicts
 * reach the project's threshold. The reporter is always the agent's owner
 * (#494). Supply projectId in the query or body and an Idempotency-Key
 * header. Optional areaId, typeId, proofLinks, attachmentIds,
 * acknowledgeSimilar.
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "ideas.create", "working", null, (agent) => createAgentIdea(agent, request));
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
