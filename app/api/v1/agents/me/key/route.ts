import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { isCrossSiteRequest } from "@/lib/agents/same-origin";
import { agentErrorResponse, requireAgent } from "@/lib/agents/require-agent";
import { agentBudgetExceededResponse, consumeAgentBudget } from "@/lib/agents/rate-budget";
import { withAgentBudgetHeaders } from "@/lib/agents/rate-budget-headers";
import { rotateKey } from "@/lib/agents/registry";

/**
 * POST /api/v1/agents/me/key — the agent rotates the key it called with
 * (#427). The old key stops working at once. The new one is returned here and sealed so the owner can copy it again from Settings.
 *
 * Authorized by the bearer token, not a session cookie. Browsers still send
 * Origin, and a cross-site Origin is rejected (#654). Clients that omit
 * Origin, such as curl, are allowed.
 */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req.headers)) {
    return NextResponse.json(
      { error: "csrf", message: "This request was sent from another site." },
      { status: 403 },
    );
  }
  let agent;
  try {
    agent = await requireAgent(req);
  } catch (error) {
    return agentErrorResponse(error);
  }
  if (agent.pausedAt) return NextResponse.json({ error: "This agent is paused by its owner." }, { status: 423 });
  // Key management is a read-class charge: it does not change the board, so
  // it must not consume the write budget a filer needs (#596).
  const budget = await consumeAgentBudget(
    { id: agent.agentId, burst: agent.burst, burstUntil: agent.burstUntil ?? null },
    "read",
  );
  if (!budget.allowed) return agentBudgetExceededResponse(budget.retryAfterSeconds, budget);

  try {
    const key = await rotateKey(agent);
    return withAgentBudgetHeaders(
      NextResponse.json(
        { api_key: key.rawKey, key_prefix: key.prefix, message: "Store this key now. It is not shown again." },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      ),
      budget,
    );
  } catch {
    return withAgentBudgetHeaders(
      NextResponse.json(
        { error: "conflict", message: "This key was already rotated or revoked." },
        { status: 409 },
      ),
      budget,
    );
  }
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
