import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentErrorResponse, assertKeyProject, requireAgent, type AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { consumeAgentBudget, agentBudgetExceededResponse } from "@/lib/agents/rate-budget";
import { withAgentBudgetHeaders, type AgentBudgetQuota } from "@/lib/agents/rate-budget-headers";
import { resolveSessionUserId } from "@/lib/session-user";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { prisma } from "@/lib/prisma";
import { FeedInputError, feedProject, parseFeedCursor, parseFeedLimit, readFeed } from "@/lib/feed";
import { parseProjectAreaFilter } from "@/lib/project-area-filter";

export async function GET(request: NextRequest) {
  let agent: AgentContext | undefined;
  let quota: AgentBudgetQuota = {};
  try {
    let organisationId: string | null;
    // A supplied bad key must not fall back to a valid browser session.
    if (request.headers.has("authorization")) {
      agent = await requireAgent(request);
      requireLevel(agent, "working");
      if (agent.pausedAt) return NextResponse.json({ error: "This agent is paused by its owner." }, { status: 423 });
      const budget = await consumeAgentBudget(
        { id: agent.agentId, burst: agent.burst, burstUntil: agent.burstUntil ?? null },
        "read",
      );
      await audit(agent, "feed.read", request.nextUrl.searchParams.get("projectId"));
      if (!budget.allowed) return agentBudgetExceededResponse(budget.retryAfterSeconds, budget);
      quota = budget;
      organisationId = agent.organisationId;
    } else {
      const session = await resolveSessionUserId();
      if ("error" in session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      organisationId = await currentOrganisationIdFor(session.userId);
    }
    if (!organisationId) return withAgentBudgetHeaders(NextResponse.json({ error: "No organisation membership." }, { status: 403 }), quota);
    const cursor = parseFeedCursor(request.nextUrl.searchParams);
    const limit = parseFeedLimit(request.nextUrl.searchParams);
    const project = await feedProject(organisationId, request.nextUrl.searchParams.get("projectId"));
    if (!project) return withAgentBudgetHeaders(NextResponse.json({ error: "Project not found." }, { status: 404 }), quota);
    if (agent) assertKeyProject(agent, project.id);
    const requestedArea = request.nextUrl.searchParams.get("area");
    const areas = requestedArea
      ? await prisma.projectArea.findMany({ where: { projectId: project.id }, select: { id: true, name: true } })
      : [];
    const area = parseProjectAreaFilter(requestedArea, areas);
    if (requestedArea?.trim() && area === null) {
      throw new FeedInputError(`Unknown area id "${requestedArea.trim()}". Use an id from this project, or "none".`);
    }
    return withAgentBudgetHeaders(
      NextResponse.json(await readFeed(organisationId, project.id, cursor, area, limit), {
        headers: { "Cache-Control": "private, no-store" },
      }),
      quota,
    );
  } catch (error) {
    if (error instanceof FeedInputError) {
      return withAgentBudgetHeaders(NextResponse.json({ error: error.message }, { status: error.status }), quota);
    }
    return withAgentBudgetHeaders(agentErrorResponse(error), quota);
  }
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
