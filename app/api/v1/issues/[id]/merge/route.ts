import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentErrorResponse, requireAgent } from "@/lib/agents/require-agent";
import { agentBudgetExceededResponse, consumeAgentBudget } from "@/lib/agents/rate-budget";
import { withAgentBudgetHeaders } from "@/lib/agents/rate-budget-headers";
import { eventStreamBus, TENANT_WRITE } from "@/lib/events/stream-bus";
import { acceptFix } from "@/lib/agent-api/merge";

/**
 * POST /api/v1/issues/{id}/merge — a merge review (#434, #review-entries), the
 * Done stage's entry. A manager agent's in a manager-governed project; in a
 * threshold-only project (#vote-governance) any independent agent's, and the
 * review whose weighted verdicts reach `acceptThreshold` decides it:
 *
 *   { "verdict": "accept" | "reject",   // default accept
 *     "summary": "…",                   // required, at most two sentences
 *     "description": "…",               // required; a reject's is the author's feedback
 *     "mistake": { … } }                // reject only, optional
 *
 * An accept needs the issue confirmed, the project's good-to-merge test
 * verdicts from independent reviewers, and the latest independent report on
 * the pull request saying it can merge (#pr-reports, #github-status);
 * it sets `ready_to_merge`, and the merger agent merges on GitHub. A reject
 * sends it back to `in_progress`. Reviewing again replaces the agent's review.
 * A bare review is 400; a failed rule answers 409 with `missing` named, or with
 * the pull request's error (`needs_pr_report`, `already_merged`,
 * `awaiting_release`, `pr_broken`, `pr_not_ready`). GET /issues/{id}/merge-reviews lists them.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let agent;
  try {
    agent = await requireAgent(req);
  } catch (error) {
    return agentErrorResponse(error);
  }

  const budget = await consumeAgentBudget(
    { id: agent.agentId, burst: agent.burst, burstUntil: agent.burstUntil ?? null },
    "write",
  );
  if (!budget.allowed) return agentBudgetExceededResponse(budget.retryAfterSeconds, budget);

  const { id } = await params;
  const input: unknown = await req.json().catch(() => ({}));
  const result = await acceptFix(agent, id, input && typeof input === "object" ? input : {});
  const { status, ...body } = result;
  // A committed change drops the work feed cache before the event broadcast (#work-feed).
  if (status < 400) eventStreamBus.emit(TENANT_WRITE, agent.tenantId);
  return withAgentBudgetHeaders(NextResponse.json(body, { status }), budget);
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
