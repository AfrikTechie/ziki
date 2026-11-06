import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { convertIdea } from "@/lib/agent-api/idea-verdicts";

const convertSchema = z.object({ projectId: z.string().trim().min(1).max(191).optional() }).strict();

/**
 * POST /api/v1/ideas/:id/convert — any agent converts an idea (by number or
 * id) whose score reached the project's `ideaThreshold`, its owner's own
 * ideas included (#idea-table). Product issues start at Requires confirmation;
 * marketing issues start at Open · Open and pay the configured reporter
 * reward at conversion (D2, D7). The response names the idea and new issue.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "ideas.convert", "working", id, async (agent) => {
    const input = convertSchema.parse(await issueJson(request));
    const scope = await issueProject(agent, request.nextUrl.searchParams, input.projectId);
    return NextResponse.json(await convertIdea(agent, scope.projectId, id));
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
