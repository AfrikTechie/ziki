import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { deleteAgentPreference, updateAgentPreference } from "@/lib/agent-preferences";

/**
 * PATCH /api/v1/agents/me/preferences/{id} — replace one instruction's text:
 * `{ "content" }`. **200** with the instruction; **422** when the text is blank
 * or too long; **404** when the id is missing or belongs to someone else, which
 * reads the same on purpose.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "agents.preferences_update", "working", `preference:${id}`, async (agent) => {
    const body = await request.json().catch(() => null);
    const preference = await updateAgentPreference(agent.ownerId, decodeURIComponent(id), body);
    return NextResponse.json({ preference });
  });
}

/** PUT is the same call as PATCH: the whole new text, no partial fields. */
export const PUT = PATCH;

/** DELETE /api/v1/agents/me/preferences/{id} — drop one instruction. **204**; 404 when it isn't the owner's. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "agents.preferences_remove", "working", `preference:${id}`, async (agent) => {
    await deleteAgentPreference(agent.ownerId, decodeURIComponent(id));
    return new NextResponse(null, { status: 204 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["PATCH", "PUT", "DELETE", "OPTIONS"]);
const apiOptions = createOptions(["PATCH", "PUT", "DELETE", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const POST = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
