import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, countAgentIssues, issueProject } from "@/lib/agent-api/issues";

/** GET ?projectId=&track=product|marketing — how many issues are in each status and ideas in each idea status (the tab counts). */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "issues.counts", "read", null, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await countAgentIssues(scope, request.nextUrl.searchParams));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
