import { NextResponse, type NextRequest } from "next/server";
import { IssueApiError } from "@/lib/agent-api/errors";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { canSeeInactiveTaskTypes, taskTypeJson, taskTypeRequest } from "@/lib/marketing/task-type-routes";
import {
  deleteMarketingTaskType,
  getMarketingTaskType,
  updateMarketingTaskType,
} from "@/lib/marketing/task-types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; typeId: string }> };

/** GET /api/v1/projects/{id}/marketing/task-types/{typeId}: one marketing task type. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id, typeId } = await context.params;
  return taskTypeRequest(request, id, "marketing.task_types.read", "read", async (actor) => {
    const taskType = await getMarketingTaskType(actor.tenantId, typeId);
    // Retired types are for the people who manage them, as in the list.
    if (!taskType.isActive && !(await canSeeInactiveTaskTypes(actor))) {
      throw new IssueApiError(404, "Marketing task type not found.", { error: "not_found", message: "Marketing task type not found." });
    }
    return NextResponse.json({ taskType });
  });
}

/**
 * PATCH /api/v1/projects/{id}/marketing/task-types/{typeId}: change the
 * name, description or isActive. Workspace owners and admins only.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id, typeId } = await context.params;
  return taskTypeRequest(request, id, "marketing.task_types.update", "change", async (actor) => {
    const taskType = await updateMarketingTaskType(actor.tenantId, actor.userId, typeId, await taskTypeJson(request));
    return NextResponse.json({ taskType });
  });
}

/**
 * DELETE /api/v1/projects/{id}/marketing/task-types/{typeId}: remove a type no
 * task or proposal uses; a type in use is `409 type_in_use` (deactivate it instead).
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id, typeId } = await context.params;
  return taskTypeRequest(request, id, "marketing.task_types.delete", "change", async (actor) => {
    return NextResponse.json(await deleteMarketingTaskType(actor.tenantId, typeId));
  });
}

const ALLOWED = ["GET", "HEAD", "PATCH", "DELETE", "OPTIONS"] as const;
const methodNotAllowed = createMethodNotAllowed(ALLOWED);
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const OPTIONS = createOptions(ALLOWED);
