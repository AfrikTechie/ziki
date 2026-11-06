import { NextResponse, type NextRequest } from "next/server";
import { IssueApiError } from "@/lib/agent-api/errors";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { canSeeInactiveTaskTypes, taskTypeJson, taskTypeRequest } from "@/lib/marketing/task-type-routes";
import { createMarketingTaskType, listMarketingTaskTypes } from "@/lib/marketing/task-types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/projects/{id}/marketing/task-types: the organisation's marketing
 * task types, A–Z (M-API-7). Any member or agent may read them, because a
 * marketing proposal's `typeId` must be one of them. `?includeInactive=true`
 * also lists retired types, for owners and admins.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return taskTypeRequest(request, id, "marketing.task_types.read", "read", async (actor) => {
    const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "true";
    if (includeInactive && !(await canSeeInactiveTaskTypes(actor))) {
      const message = "Only organisation owners and admins can list inactive marketing task types.";
      throw new IssueApiError(403, message, { error: "forbidden", message });
    }
    const taskTypes = await listMarketingTaskTypes(actor.organisationId, { includeInactive });
    return NextResponse.json({ projectId: actor.projectId, taskTypes });
  });
}

/**
 * POST /api/v1/projects/{id}/marketing/task-types: create a marketing task
 * type. Organisation owners and admins only. No points (D5).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return taskTypeRequest(request, id, "marketing.task_types.create", "change", async (actor) => {
    const taskType = await createMarketingTaskType(actor.organisationId, await taskTypeJson(request));
    return NextResponse.json({ taskType }, { status: 201 });
  });
}

const ALLOWED = ["GET", "HEAD", "POST", "OPTIONS"] as const;
const methodNotAllowed = createMethodNotAllowed(ALLOWED);
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = createOptions(ALLOWED);
