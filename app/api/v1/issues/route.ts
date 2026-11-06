import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, listAgentIssues } from "@/lib/agent-api/issues";

/** GET ?projectId=&track=product|marketing&status=&area=&assignee=&q=&cursor=&limit= */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "issues.list", "read", null, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await listAgentIssues(scope, request.nextUrl.searchParams));
  });
}

// Issues are never filed directly (#idea-table): a report is an idea
// (`POST /api/v1/ideas`), and converting the idea creates the issue.
const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
