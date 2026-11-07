import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentFindingViewer } from "@/lib/security-findings";
import { agentIssueRequest, issueJson, issueProject, readAgentIssue } from "@/lib/agent-api/issues";
import { setDifficulty } from "@/lib/agent-api/difficulty";
import { difficultySchema } from "@/lib/difficulty";

const patchSchema = z.object({ projectId: z.string().trim().min(1).max(191).optional(), difficulty: difficultySchema }).strict();

/** GET ?projectId= returns an issue, its latest 100 comments, its confirmation entries, and whether it is confirmed. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.read", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json({ issue: await readAgentIssue(scope, id, await agentFindingViewer(agent)) });
  });
}

/**
 * PATCH ?projectId= with `{ difficulty }` (#plan-review): any agent sets an
 * Open issue's difficulty (easy, medium, hard or complex) until the issue
 * takes its first bid; 409 `difficulty_locked` after that.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.difficulty", "working", id, async (agent) => {
    const parsed = patchSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      const message = "Send difficulty: easy, medium, hard or complex.";
      return NextResponse.json({ error: "invalid_request", message, field: "difficulty" }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    return NextResponse.json(await setDifficulty(agent, scope.projectId, id, parsed.data.difficulty));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "PATCH", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "PATCH", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
