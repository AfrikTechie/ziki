import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentErrorResponse, requireAgent } from "@/lib/agents/require-agent";
import { agentBudgetExceededResponse, consumeAgentBudget } from "@/lib/agents/rate-budget";
import { withAgentBudgetHeaders } from "@/lib/agents/rate-budget-headers";
import { eventStreamBus, TENANT_WRITE } from "@/lib/events/stream-bus";
import { listTestVerdicts, submitTestVerdict } from "@/lib/agent-api/test-verdict";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";

/**
 * POST /api/v1/issues/{id}/test-results — a reviewer agent reports whether a
 * fix is good to merge (#434). Body:
 *
 *   { "goodToMerge": true,
 *     "summary": "…",          // required, at most two sentences
 *     "description": "…",      // required, what you tested and why
 *     "files": [{ "path": "app/x.ts", "lines": "40-58" }], // required: the changed files you judged
 *     "headSha": "…", "onBehalfOfUserId": "…" }
 *
 * A verdict is the Done stage's entry (#review-entries); a bare one is 400.
 * 201 returns the verdict. Reporting again replaces this agent's verdict and
 * returns 200 with `changed: true` (#529), until the fix is accepted. A
 * pull request must be linked first; the verdict records it (#526). It is one
 * reviewer's opinion; a merger accepts the fix with `POST /api/v1/issues/{id}/merge`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let agent;
  try {
    agent = await requireAgent(req);
  } catch (error) {
    return agentErrorResponse(error);
  }
  if (agent.pausedAt) return NextResponse.json({ error: "This agent is paused by its owner." }, { status: 423 });

  const budget = await consumeAgentBudget(
    { id: agent.agentId, burst: agent.burst, burstUntil: agent.burstUntil ?? null },
    "write",
  );
  if (!budget.allowed) return agentBudgetExceededResponse(budget.retryAfterSeconds, budget);

  const { id } = await params;
  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return withAgentBudgetHeaders(
      NextResponse.json({ error: "invalid_request", message: "Send a JSON object." }, { status: 400 }),
      budget,
    );
  }

  const result = await submitTestVerdict(agent, id, body);
  // A committed verdict drops the work feed cache before the event broadcast (#work-feed).
  if (result.status === 200 || result.status === 201) eventStreamBus.emit(TENANT_WRITE, agent.tenantId);

  if (result.status === 201) {
    return withAgentBudgetHeaders(NextResponse.json({ verdict: result.verdict }, { status: 201 }), budget);
  }
  if (result.status === 200) {
    return withAgentBudgetHeaders(NextResponse.json({ verdict: result.verdict, changed: true }, { status: 200 }), budget);
  }
  const { status, ...error } = result;
  return withAgentBudgetHeaders(NextResponse.json(error, { status }), budget);
}

/**
 * GET ?projectId= — every test verdict on the issue, newest first, each with
 * its replies and whether it is on the pull request (and commit) linked now.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.test_verdicts", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    // #confirmation-files: other testers' files show once this agent's owner has judged too.
    return NextResponse.json(await listTestVerdicts(scope, id, { userId: agent.ownerId }));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
