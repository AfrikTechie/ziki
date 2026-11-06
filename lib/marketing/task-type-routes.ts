import { NextResponse, type NextRequest } from "next/server";
import { IssueApiError } from "@/lib/agent-api/errors";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { assertMarketingSettingsAccess } from "@/lib/marketing/settings";
import { marketingTaskTypeProject } from "@/lib/marketing/task-types";
import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/lib/roles";
import { resolveSessionUserId } from "@/lib/session-user";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";

/**
 * Shared plumbing for /api/v1/projects/{id}/marketing/task-types (M-API-7).
 * A request with an `Authorization` header is an agent, acting for its owner.
 * Without one it is a signed-in person. Both get the same access rule: any
 * member of the organisation may read, and only owners and admins may change.
 */

export type TaskTypeActor = {
  organisationId: string;
  projectId: string;
  /** The person acting: the signed-in user, or the agent's owner. */
  userId: string;
  role: AppRole | null;
};

type Access = "read" | "change";

function errorResponse(error: IssueApiError): Response {
  return NextResponse.json(error.body ? { error: error.message, ...error.body } : { error: error.message }, { status: error.status });
}

/** Writes are for organisation owners and admins only. */
export async function assertTaskTypeAccess(actor: TaskTypeActor, access: Access): Promise<void> {
  if (access === "change") await assertMarketingSettingsAccess({ id: actor.userId, role: actor.role }, actor.organisationId, "change");
}

/** Whether the actor may see retired types: owners and admins, who manage them. */
export async function canSeeInactiveTaskTypes(actor: TaskTypeActor): Promise<boolean> {
  return isAdminOfOrganisation({ id: actor.userId, role: actor.role }, actor.organisationId);
}

async function sessionActor(projectIdOrSlug: string): Promise<TaskTypeActor | Response> {
  const session = await resolveSessionUserId();
  if ("error" in session) {
    return NextResponse.json({ error: "unauthorized", message: "Authentication required." }, { status: 401 });
  }
  const organisationId = await currentOrganisationIdFor(session.userId);
  if (!organisationId) return NextResponse.json({ error: "no_organisation", message: NO_ORGANISATION_MESSAGE }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, role: true } });
  if (!user) return NextResponse.json({ error: "unauthorized", message: "User not found." }, { status: 401 });
  const project = await marketingTaskTypeProject(organisationId, projectIdOrSlug);
  return { organisationId, projectId: project.id, userId: user.id, role: user.role ?? null };
}

/**
 * Runs `run` as the caller after resolving the project and checking `access`.
 * `action` names the call in the agent audit log.
 */
export async function taskTypeRequest(
  request: NextRequest,
  projectIdOrSlug: string,
  action: string,
  access: Access,
  run: (actor: TaskTypeActor) => Promise<Response>,
): Promise<Response> {
  if (!request.headers.has("authorization")) {
    try {
      const actor = await sessionActor(projectIdOrSlug);
      if (actor instanceof Response) return actor;
      await assertTaskTypeAccess(actor, access);
      return await run(actor);
    } catch (error) {
      if (error instanceof IssueApiError) return errorResponse(error);
      throw error;
    }
  }

  return agentIssueRequest(request, action, "working", projectIdOrSlug, async (agent) => {
    const project = await marketingTaskTypeProject(agent.organisationId, projectIdOrSlug);
    // A key issued for one project cannot act in another (#742).
    const actor: TaskTypeActor = {
      organisationId: agent.organisationId,
      projectId: project.id,
      userId: agent.ownerId,
      role: agent.ownerRole ?? null,
    };
    await assertTaskTypeAccess(actor, access);
    return run(actor);
  });
}

/** Reads the JSON body; a missing or broken body is a 400. */
export async function taskTypeJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    const message = "Send a valid JSON body.";
    throw new IssueApiError(400, message, { error: "invalid_request", message });
  }
}
