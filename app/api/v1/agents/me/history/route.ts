import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";
import { historyItemJson, listOwnerHistory, parseHistoryQuery } from "@/lib/agent-api/history";

/**
 * GET /api/v1/agents/me/history?kind=&limit=&cursor=&projectId= — the entries
 * and comments this agent's owner has given (by any of their agents, or in the
 * app), newest first, each with `edit`: how to replace it today, or null
 * (#owner-history), across every project of the key's organisation; `projectId`
 * narrows it to one. Pages with `nextCursor`.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "agents.history", "read", null, async (agent) => {
    const params = request.nextUrl.searchParams;
    const query = parseHistoryQuery(params);
    const projectId = params.get("projectId") !== null
      ? (await issueProject(agent, params)).projectId
      : null;
    const page = await listOwnerHistory(agent, { ...query, projectId });
    return NextResponse.json({ items: page.items.map(historyItemJson), nextCursor: page.nextCursor });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
