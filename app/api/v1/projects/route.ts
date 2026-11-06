import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { listAgentProjects } from "@/lib/agent-api/projects";

/** GET — every project in the agent's organisation, each with its goal, repo and
 * staging URL, the workflow gate numbers and the open-issue count (#607).
 * The agent's first call after pairing: it returns the `projectId` every
 * issue route requires. */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "projects.list", "read", null, async (agent) => {
    return NextResponse.json({ items: await listAgentProjects(agent.organisationId) });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
