import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, PROJECT_ID_REQUIRED } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/v1/claims — returns active claims for the calling agent's owner (#643).
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "claims.list", "read", null, async (agent) => {
    const params = request.nextUrl.searchParams;
    if (!params.get("projectId")) return NextResponse.json({ error: PROJECT_ID_REQUIRED }, { status: 400 });
    const scope = await issueProject(agent, params);

    const claims = await prisma.issueClaim.findMany({
      where: {
        beneficiaryUserId: agent.ownerId,
        status: "active",
        releasedAt: null,
        bug: { organisationId: agent.organisationId, projectId: scope.projectId, isDeleted: false },
      },
      select: {
        id: true,
        status: true,
        claimedAt: true,
        deliverBy: true,
        agentId: true,
        beneficiaryUserId: true,
        bug: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
          },
        },
      },
      orderBy: { claimedAt: "desc" },
    });

    return NextResponse.json({
      claims: claims.map((c) => ({
        id: c.id,
        status: c.status,
        agent_id: c.agentId,
        beneficiary_user_id: c.beneficiaryUserId,
        claimed_at: c.claimedAt?.toISOString() ?? null,
        deliver_by: c.deliverBy?.toISOString() ?? null,
        issue_id: c.bug.id,
        issue_number: c.bug.number,
        issue_title: c.bug.title,
        issue_status: c.bug.status,
      })),
    });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
