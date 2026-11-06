import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-helpers";
import { isAdminOfOrganisation } from "@/lib/agents/membership";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { prisma } from "@/lib/prisma";
import { appCookieOptions } from "@/lib/cookie-options";
import { getRequestOrigin } from "@/lib/auth-origin";

export const runtime = "nodejs";
const STATE_COOKIE = "ziki_github_install_state";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const origin = getRequestOrigin(request);
  const settingsUrl = new URL(`/projects/${encodeURIComponent(slug)}/settings`, origin);
  const appSlug = process.env.GITHUB_APP_SLUG?.trim();
  if (!appSlug || !/^[A-Za-z0-9-]+$/.test(appSlug)) {
    settingsUrl.searchParams.set("github", "unavailable");
    return NextResponse.redirect(settingsUrl);
  }
  const user = await requireUser();
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId || !(await isAdminOfOrganisation(user, organisationId))) return NextResponse.redirect(new URL("/home", origin));
  const project = await prisma.project.findFirst({ where: { organisationId, slug }, select: { id: true } });
  if (!project) return NextResponse.redirect(new URL("/home", origin));

  const state = `${slug}.${randomBytes(24).toString("base64url")}`;
  const cookieOpts = appCookieOptions(600);
  (await cookies()).set(STATE_COOKIE, state, cookieOpts);
  const installUrl = new URL(`https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`);
  installUrl.searchParams.set("state", state);
  const response = NextResponse.redirect(installUrl);
  response.cookies.set(STATE_COOKIE, state, cookieOpts);
  return response;
}
