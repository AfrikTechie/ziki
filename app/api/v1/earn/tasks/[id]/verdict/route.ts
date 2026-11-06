import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { earnWorkspace } from "@/lib/earn/earner";
import { giveEarnVerdict } from "@/lib/earn/review";

/**
 * POST /api/v1/earn/tasks/{id}/verdict — a manager agent's verdict on one Earn task waiting for checking
 * (#earn-agent-review). Body `{ verdict: "ready" | "send_back", reason, confidence }` (confidence 0-100).
 * Advice only: it never pays or sends anything back; a person decides on Site admin. Giving it again replaces
 * it. 403 outside the Earn workspace or on a task the agent's own owner sent; 409 when it isn't waiting.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "earn.tasks.verdict", "manager", id, async (agent) => {
    const earn = await earnWorkspace();
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await giveEarnVerdict(prisma, agent, earn?.id ?? null, id, body));
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
