import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { clearLinkedIssue, linkedIssueSchema, setLinkedIssue } from "@/lib/agent-api/linked-issue";

export const runtime = "nodejs";

/**
 * PUT /api/v1/issues/{id}/linked-issue — link a marketing issue to a related
 * product issue in the same project (D6): `{ "issueId": "…", "projectId": "…" }`.
 * Any agent may. 200 `{ issueId, linkedIssue: { id, number, title }, changed }`.
 * 409 `wrong_track` from a product issue or to a marketing one; 404 for an issue
 * outside the project.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issue.linked_issue_set", "working", id, async (agent) => {
    const parsed = linkedIssueSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", message: "Send an issueId, the product issue to link to.", field: "issueId" },
        { status: 400 },
      );
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    return NextResponse.json(await setLinkedIssue(agent, scope, id, parsed.data.issueId));
  });
}

/** DELETE ?projectId= — clear the link. Clearing an issue with no link changes nothing. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issue.linked_issue_cleared", "working", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await clearLinkedIssue(agent, scope, id));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["PUT", "DELETE", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const POST = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const OPTIONS = createOptions(["PUT", "DELETE", "OPTIONS"]);
