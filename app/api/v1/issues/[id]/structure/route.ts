import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { structureIssue, structureInputSchema } from "@/lib/agent-api/structure";

/**
 * POST /api/v1/issues/[id]/structure
 * Autonomous agent structuring & triage endpoint (#764).
 * Checks duplicates, infers type, formats structured description,
 * and logs activity.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.structure", "working", id, async (agent) => {
    const rawBody = await issueJson(request);
    const parsed = structureInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid structure payload.", details: parsed.error.issues },
        { status: 422 },
      );
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    const result = await structureIssue(agent, scope.projectId, id, parsed.data);
    return NextResponse.json(result, { status: 200 });
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
