import { NextResponse, type NextRequest } from "next/server";
import { IssueApiError, agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { resolveSessionUserId } from "@/lib/session-user";
import { currentOrganisationIdFor, NO_ORGANISATION_MESSAGE } from "@/lib/organisation-context";
import { prisma } from "@/lib/prisma";
import {
  assertMarketingSettingsAccess,
  getMarketingSettings,
  updateMarketingSettings,
} from "@/lib/marketing/settings";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function handleSessionGet(request: NextRequest, projectId: string) {
  const session = await resolveSessionUserId();
  if ("error" in session) {
    return NextResponse.json({ error: "unauthorized", message: "Authentication required." }, { status: 401 });
  }
  const organisationId = await currentOrganisationIdFor(session.userId);
  if (!organisationId) {
    return NextResponse.json({ error: "no_organisation", message: NO_ORGANISATION_MESSAGE }, { status: 400 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true },
  });
  if (!user) {
    return NextResponse.json({ error: "unauthorized", message: "User not found." }, { status: 401 });
  }

  try {
    await assertMarketingSettingsAccess(user, organisationId, "view");
    const settings = await getMarketingSettings(organisationId, projectId);
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof IssueApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

async function handleSessionUpdate(request: NextRequest, projectId: string) {
  const session = await resolveSessionUserId();
  if ("error" in session) {
    return NextResponse.json({ error: "unauthorized", message: "Authentication required." }, { status: 401 });
  }
  const organisationId = await currentOrganisationIdFor(session.userId);
  if (!organisationId) {
    return NextResponse.json({ error: "no_organisation", message: NO_ORGANISATION_MESSAGE }, { status: 400 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true },
  });
  if (!user) {
    return NextResponse.json({ error: "unauthorized", message: "User not found." }, { status: 401 });
  }

  try {
    await assertMarketingSettingsAccess(user, organisationId, "change");
    const body = await issueJson(request);
    const updated = await updateMarketingSettings(organisationId, projectId, user.id, body);
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof IssueApiError) {
      return NextResponse.json(
        { error: error.message, ...(error.body ? { details: error.body } : {}) },
        { status: error.status },
      );
    }
    throw error;
  }
}

/**
 * GET /api/v1/projects/{id}/marketing/settings: read the project's marketing dials.
 * Restricted to organisation owners and admins (M-API-6).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!request.headers.has("authorization")) {
    return handleSessionGet(request, id);
  }

  return agentIssueRequest(request, "marketing.settings.read", "working", id, async (agent) => {
    await assertMarketingSettingsAccess(
      { id: agent.ownerId, role: agent.ownerRole },
      agent.organisationId,
      "view",
    );
    const settings = await getMarketingSettings(agent.organisationId, id);
    return NextResponse.json(settings);
  });
}

/**
 * PATCH /api/v1/projects/{id}/marketing/settings: update the project's marketing dials.
 * Restricted to organisation owners and admins (M-API-6).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!request.headers.has("authorization")) {
    return handleSessionUpdate(request, id);
  }

  return agentIssueRequest(request, "marketing.settings.update", "working", id, async (agent) => {
    await assertMarketingSettingsAccess(
      { id: agent.ownerId, role: agent.ownerRole },
      agent.organisationId,
      "change",
    );
    const body = await issueJson(request);
    const updated = await updateMarketingSettings(agent.organisationId, id, agent.ownerId, body);
    return NextResponse.json(updated);
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "PATCH", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const POST = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "HEAD", "PATCH", "OPTIONS"]);
