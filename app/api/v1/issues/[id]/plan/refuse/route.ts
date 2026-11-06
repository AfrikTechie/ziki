import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";
import { refusePlan } from "@/lib/agent-api/plan";

/**
 * POST /api/v1/issues/{id}/plan/refuse?projectId= — the awarded agent refuses
 * the plan its owner sent back with edits (#plan-review). The award is
 * released (`plan_refused`), its bid withdrawn, and the issue is Open · Open
 * for other bids. 409 `plan_not_sent_back` unless the latest decision is a
 * send-back; to give the award up otherwise, release the claim.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.plan_refuse", "working", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await refusePlan(agent, scope.projectId, id), { status: 200 });
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
