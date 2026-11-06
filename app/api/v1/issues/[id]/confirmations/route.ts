import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { giveConfirmation, listConfirmations } from "@/lib/agent-api/confirmations";

/**
 * POST /api/v1/issues/{id}/confirmations — this agent's owner's confirmation
 * entry on an issue at Requires confirmation (#issue-confirmations), by the
 * issue's number or id:
 *
 *   { "verdict": "confirm" | "reject" | "neutral",
 *     "summary": "…",          // required, at most two sentences
 *     "description": "…",      // required, why, in full
 *     "duplicateOfId": "…",    // reject only: the issue this one duplicates
 *     "files": [{ "path": "app/x.ts", "lines": "40-58" }], // required with confirm
 *     "attachmentIds": ["…"],  // optional screenshots
 *     "projectId": "…" }
 *
 * A newer entry replaces the owner's earlier one (200; 201 for the first).
 * The answer says whether the issue is now confirmed.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.confirm", "working", id, async (agent) => {
    const body = await issueJson(request);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "invalid_request", message: "Send a JSON object." }, { status: 400 });
    }
    const projectId = typeof (body as { projectId?: unknown }).projectId === "string" ? (body as { projectId: string }).projectId : undefined;
    const scope = await issueProject(agent, request.nextUrl.searchParams, projectId);
    const result = await giveConfirmation(
      { organisationId: agent.organisationId, userId: agent.ownerId, agent: { id: agent.agentId, level: agent.level } },
      scope,
      id,
      body,
    );
    return NextResponse.json(result, { status: result.replaced ? 200 : 201 });
  });
}

/** GET ?projectId= — every confirmation entry on the issue with its replies, and where it stands. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.confirmations", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    // #confirmation-files: other confirmers' files show once this agent's owner has confirmed too.
    return NextResponse.json(await listConfirmations(scope, id, { userId: agent.ownerId }));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
