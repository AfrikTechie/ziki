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
 * that organisation and the project is in it, makes that organisation current, and
 * goes back to `next`. The project itself always comes from the URL's slug.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) return redirectTo("/login");

  const url = new URL(request.url);
  const organisationId = url.searchParams.get("organisation") ?? "";
  const user = await prisma.user.findUnique({ where: { id: resolved.userId }, select: { role: true } });
  const allowed = user?.role === "super_admin"
    || Boolean(await prisma.membership.findUnique({ where: { organisationId_userId: { organisationId, userId: resolved.userId } }, select: { id: true } }));
  const project = allowed
    ? await prisma.project.findFirst({ where: { organisationId, slug, archivedAt: null }, select: { id: true, slug: true, organisation: { select: { slug: true } } } })
    : null;
  if (!project) return redirectTo("/");
  await setActiveOrganisationCookie(organisationId);
  return redirectTo(safeNext(url.searchParams.get("next"), projectPath(refOf(project))));
}
