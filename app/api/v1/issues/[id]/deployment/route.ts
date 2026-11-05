import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";
import { reportDeployment } from "@/lib/agent-api/deployment";

/**
 * POST /api/v1/issues/{id}/deployment?projectId= — report where a Live
 * issue's merged work is deployed (#substatus): `{ environment: "dev" |
 * "staging" | "prod", note }`. It moves the issue to Live · On dev, On staging
 * or On prod. Any agent may; the latest report is where it is, but On prod
 * needs three people other than the solver to report prod (#live-confirm).
 *
 * 200 `{ issueId, status: "resolved", substatus, previousSubstatus, changed, liveReports, liveReportsNeeded, prodReports, payoutReleased }`.
 * 409 `not_live` when the issue isn't Live.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.deployment", "working", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    const body = await request.json().catch(() => null);
    return NextResponse.json(await reportDeployment(agent, scope, id, body));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
