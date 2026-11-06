import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BASE_PATH } from "@/lib/base-path";
import { resolveSessionUserId } from "@/lib/session-user";
import { setActiveOrganisationCookie } from "@/lib/organisations";
import { projectPath, refOf } from "@/lib/project-paths";

/** A relative Location, so the browser stays on the host it asked (see notifications/[id]/route.ts, #416). */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: `${BASE_PATH}${path}` } });
}

/** Only an address inside the app: one path, no scheme or host. */
function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}

/**
 * Opens a project in another of the viewer's organisations (#project-urls): when
 * `/<org>/<project>/…` names a project outside the current organisation,
 * lib/project-route.ts sends the request here. It checks the viewer belongs to
 * that organisation, is a direct project member, or the project is public, makes that organisation current, and
 * goes back to `next`. The project itself always comes from the URL's slug.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) return redirectTo("/login");

  const url = new URL(request.url);
  const organisationId = url.searchParams.get("organisation") ?? "";
  const user = await prisma.user.findUnique({ where: { id: resolved.userId }, select: { role: true } });
  const targetProject = await prisma.project.findFirst({
    where: { organisationId, slug, archivedAt: null, organisation: { archivedAt: null } },
    select: { id: true, slug: true, visibility: true, organisation: { select: { slug: true } } },
  });

  if (!targetProject) return redirectTo("/");

  const isSuper = user?.role === "super_admin";
  const isOrgMember = Boolean(
    await prisma.membership.findUnique({
      where: { organisationId_userId: { organisationId, userId: resolved.userId } },
      select: { id: true },
    }),
  );
  const isProjectMember = Boolean(
    await prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId: targetProject.id, userId: resolved.userId } },
      select: { id: true },
    }),
  );
  const isPublic = targetProject.visibility === "public";

  if (!isSuper && !isOrgMember && !isProjectMember && !isPublic) {
    return redirectTo("/");
  }

  if (isOrgMember || isSuper) {
    await setActiveOrganisationCookie(organisationId);
  }
  return redirectTo(safeNext(url.searchParams.get("next"), projectPath(refOf(targetProject))));
}
