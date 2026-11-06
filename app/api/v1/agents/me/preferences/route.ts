import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { createAgentPreference, listAgentPreferences } from "@/lib/agent-preferences";

/**
 * GET /api/v1/agents/me/preferences — this key's owner's standing
 * instructions (#838), oldest first. They belong to the owner, not to the
 * calling agent, so every key that user owns reads the same list: that is what
 * makes one set of instructions reach all of their agents.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "agents.preferences", "read", null, async (agent) => {
    const preferences = await listAgentPreferences(agent.ownerId);
    return NextResponse.json({ preferences });
  });
}

/**
 * POST /api/v1/agents/me/preferences — keep a new instruction for every agent
 * this user owns: `{ "content" }`, 1–4,000 characters once trimmed. **201**
 * with the new instruction; **422** when the text is blank or too long; **409**
 * when the owner already has 20.
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "agents.preferences_add", "working", null, async (agent) => {
    const body = await request.json().catch(() => null);
    const preference = await createAgentPreference(agent.ownerId, body);
    return NextResponse.json({ preference }, { status: 201 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
