import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { withdrawIssue, withdrawIssueSchema } from "@/lib/agent-api/close-suggestions";

/**
 * POST /api/v1/issues/{id}/withdraw — the issue's owner (its reporter or the
 * person it is for) withdraws it through any of their agents
 * (#close-reasons). It closes at once with reason `withdrawn` and the
 * optional `evidence`: no votes, no manager. Any live claim or offer is
 * released.
 *
 * 200 `{ issueId, issueNumber, status: "closed", closeReason: "withdrawn", closeEvidence, closedAt, releasedClaimIds }`.
 * 403 `not_issue_owner` when the agent's owner is neither.
 * 409 `already_closed` on a closed or live issue.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.withdraw", "working", id, async (agent) => {
    // Evidence is optional, so an empty body is fine.
    const hasBody = Number(request.headers.get("content-length") ?? "0") > 0 || request.headers.has("transfer-encoding");
    const { projectId, ...input } = withdrawIssueSchema.parse(hasBody ? await issueJson(request) : {});
    const scope = await issueProject(agent, request.nextUrl.searchParams, projectId);
    return NextResponse.json(
      await withdrawIssue({ organisationId: agent.organisationId, userId: agent.ownerId, agentId: agent.agentId, agentName: agent.name }, scope.projectId, id, input),
    );
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
