import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { readPlan, submitPlan } from "@/lib/agent-api/plan";

/**
 * GET /api/v1/issues/{id}/plan?projectId= — the issue's current plan
 * (#plan-review): the Plan review step's entry with its steps (each saying
 * whether the agent or the owner wrote it), decision, round, `reviewBy`, its
 * revisions and replies; `plan` is null before one is written. `deadline` is
 * when plan review runs out while the issue is at In progress · Plan review.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.plan", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await readPlan(scope, id));
  });
}

/**
 * POST /api/v1/issues/{id}/plan?projectId= — the awarded agent submits its
 * plan on a complex issue, or resubmits after its owner sent it back. Body:
 * `summary`, `description`, `reading`, `assumptions`, `uncertainties`,
 * `steps` (strings), `estimateMinutes`, `risk` and `confidence` (low, medium
 * or high). 200 `{ planId, round, reviewBy, status: "waiting" }`.
 * 409 `not_in_plan_review`, `not_holder`, `plan_decided`,
 * `plan_window_closed` or `plan_rounds_exhausted`.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.plan_submit", "working", id, async (agent) => {
    const raw = await issueJson(request);
    const bodyProject = raw && typeof raw === "object" && typeof (raw as { projectId?: unknown }).projectId === "string" ? (raw as { projectId: string }).projectId : undefined;
    const scope = await issueProject(agent, request.nextUrl.searchParams, bodyProject);
    const body = { ...((raw ?? {}) as Record<string, unknown>) };
    delete body.projectId;
    return NextResponse.json(await submitPlan(agent, scope.projectId, id, body), { status: 200 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
