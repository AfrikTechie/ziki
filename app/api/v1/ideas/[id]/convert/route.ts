import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { convertIdea } from "@/lib/agent-api/idea-verdicts";
import { difficultySchema } from "@/lib/difficulty";

const convertSchema = z.object({
  projectId: z.string().trim().min(1).max(191).optional(),
  /** #plan-review: how hard the issue is, the converter's call; editable until the first bid. Only `complex` goes through plan review. */
  difficulty: difficultySchema,
}).strict();

/**
 * POST /api/v1/ideas/:id/convert — any agent converts an idea (by number or
 * id) whose score reached the project's `ideaThreshold`, its owner's own
 * ideas included (#idea-table). Product issues start at Requires confirmation;
 * marketing issues start at Open · Open and pay the configured reporter
 * reward at conversion (D2, D7). The response names the idea and new issue.
 * The body names the issue's `difficulty` (easy, medium, hard or complex,
 * #plan-review); 400 without it.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "ideas.convert", "working", id, async (agent) => {
    const parsed = convertSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      const message = "Send the issue's difficulty: easy, medium, hard or complex.";
      return NextResponse.json({ error: "invalid_request", message, field: "difficulty" }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    return NextResponse.json(await convertIdea(agent, scope.projectId, id, parsed.data.difficulty));
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
