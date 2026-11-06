import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-helpers";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { prisma } from "@/lib/prisma";
import { getRequestOrigin } from "@/lib/auth-origin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
const STATE_COOKIE = "ziki_github_install_state";

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);
  const query = request.nextUrl.searchParams;
  const installationId = (query.get("installation_id") ?? "").trim();
  const state = (query.get("state") ?? "").trim();
  const setupAction = (query.get("setup_action") ?? "").trim();
  const error = (query.get("error") ?? "").trim();

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value?.trim();
  jar.delete(STATE_COOKIE);

  const slugFromExpected = expected?.split(".", 1)[0] ?? "";
  const slugFromState = state.split(".", 1)[0] ?? "";
  const slug = slugFromExpected || slugFromState;

  const settingsUrl = slug && /^[a-z0-9-]{1,48}$/.test(slug)
    ? new URL(`/projects/${encodeURIComponent(slug)}/settings`, origin)
    : new URL("/home", origin);

  if (error) {
    logger.warn("[github] installation callback error from GitHub", { error, errorDescription: query.get("error_description") });
    settingsUrl.searchParams.set("github", error === "access_denied" ? "cancelled" : "error");
    const response = NextResponse.redirect(settingsUrl);
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  if (setupAction === "request") {
    logger.info("[github] installation requested on GitHub, awaiting approval", { slug, installationId });
    settingsUrl.searchParams.set("github", "requested");
    const response = NextResponse.redirect(settingsUrl);
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  const isStateMismatch = Boolean(state && expected && state !== expected);
  const hasValidState = Boolean(expected || (state && /^[a-z0-9-]{1,48}\.[A-Za-z0-9_-]+$/.test(state)));
  const isValidSlug = /^[a-z0-9-]{1,48}$/.test(slug);
  const isValidInstallationId = /^\d{1,20}$/.test(installationId);
  const isValidAction = ["install", "update", ""].includes(setupAction);

  if (!hasValidState || isStateMismatch || !isValidSlug || !isValidInstallationId || !isValidAction) {
    logger.warn("[github] rejected invalid installation callback", {
      hasExpected: Boolean(expected),
      hasState: Boolean(state),
      isStateMismatch,
      isValidSlug,
      isValidInstallationId,
      isValidAction,
      setupAction,
    });
    settingsUrl.searchParams.set("github", "error");
    const response = NextResponse.redirect(settingsUrl);
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId || !(await isAdminOfOrganisation(user, organisationId))) {
    const response = NextResponse.redirect(new URL("/home", origin));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  const project = await prisma.project.findFirst({
    where: { organisationId, slug },
    select: { id: true, githubInstallationId: true },
  });
  if (!project) {
    const response = NextResponse.redirect(new URL("/home", origin));
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: project.id },
      data: { githubInstallationId: installationId },
    });
    await tx.projectAuditEvent.create({
      data: {
        organisationId,
        projectId: project.id,
        actorUserId: user.id,
        action: "github.installation.connected",
        changes: { githubInstallationId: { from: project.githubInstallationId, to: installationId } },
      },
    });
  });

  settingsUrl.searchParams.set("github", "connected");
  const response = NextResponse.redirect(settingsUrl);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
