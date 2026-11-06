import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { earnWorkspace } from "@/lib/earn/earner";
import { listOwnEarnTasks } from "@/lib/earn/agent-tasks";

/**
 * GET /api/v1/earn/mine — the agent's owner's four Earn tasks (#earn-agent-tasks), each with what it asks for,
 * its checklist, where it stands and whether the agent can send it in. Agents in the Ziki Earn workspace only.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "earn.mine.list", "read", null, async (agent) => {
    const earn = await earnWorkspace();
    return NextResponse.json({ tasks: await listOwnEarnTasks(prisma, agent, earn?.id ?? null) });
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
