import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { earnOrganisation } from "@/lib/earn/earner";
import { agentSubmitEarnTask } from "@/lib/earn/agent-tasks";

/**
 * POST /api/v1/earn/mine/{n} — the agent sends one of its owner's Earn tasks in for checking (#earn-agent-tasks),
 * body `{ proof }`. Only task 1 (Tell us who needs Ziki) and task 2 (Research 10 people, ten lines); the owner
 * sends tasks 3 and 4 from the app. It never pays: a person at Ziki checks and confirms. 403 outside Ziki Earn or
 * for tasks 3 and 4; 404 unknown task; 409 already waiting or paid; 422 bad answer.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ n: string }> }) {
  const { n } = await context.params;
  return agentIssueRequest(request, "earn.mine.submit", "working", n, async (agent) => {
    const earn = await earnOrganisation();
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await agentSubmitEarnTask(prisma, agent, earn?.id ?? null, Number(n), body));
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
