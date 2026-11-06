import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, IssueApiError } from "@/lib/agent-api/issues";
import { heartbeatClaim } from "@/lib/agent-api/availability";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // #556: heartbeats have their own budget so they never compete with the
  // write budget an actively-working agent needs for real work.
  return agentIssueRequest(request, "claims.heartbeat", "working", id, async (agent) => {
    if (!request.nextUrl.searchParams.get("projectId")) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    try {
      const claim = await heartbeatClaim(agent, scope.projectId, id);
      const steering = await prisma.agentInboxItem.findMany({
        where: { agentId: agent.agentId, bugId: claim.bugId, eventType: "agent.steer", readAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, payload: true, createdAt: true },
      });
      return NextResponse.json({
        claim,
        steering: steering.map((item) => ({
          ...item,
          acknowledge_url: `/api/v1/issues/${id}/steer/${item.id}/ack?projectId=${scope.projectId}`,
        })),
      });
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      return NextResponse.json({ error: "Heartbeat unavailable; try again." }, { status: 503 });
    }
  }, { budget: "heartbeat" });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
