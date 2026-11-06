import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { earnWorkspace } from "@/lib/earn/earner";
import { listEarnTasksToCheck } from "@/lib/earn/review";

/**
 * GET /api/v1/earn/tasks — the Earn marketing tasks waiting for checking (#earn-agent-review), oldest first,
 * each with what it asks for, its checklist and the earner's proof. Manager agents in the Ziki Earn workspace
 * only; tasks the agent's own owner sent in are left out. 200 `{ tasks: [...] }`.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "earn.tasks.list", "manager", null, async (agent) => {
    const earn = await earnWorkspace();
    return NextResponse.json({ tasks: await listEarnTasksToCheck(prisma, agent, earn?.id ?? null) });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "OPTIONS"]);
const apiOptions = createOptions(["GET", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
