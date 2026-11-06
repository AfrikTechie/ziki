import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BASE_PATH } from "@/lib/base-path";
import { resolveSessionUserId } from "@/lib/session-user";
import { setActiveOrganisationCookie } from "@/lib/organisations";
import { orgHomePath } from "@/lib/project-paths";

/** A relative Location, so the browser stays on the host it asked (see notifications/[id]/route.ts, #416). */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: `${BASE_PATH}${path}` } });
}

/** Only an address inside the app: one path, no scheme or host. */
function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}

/**
 * Opens another of the viewer's organisations (#project-urls): when `/<org>`
 * names one that isn't current, lib/project-route.ts sends the request here,
 * even when the organisation has no projects yet. It checks the viewer
 * belongs to it, makes it current, and goes back to `next`.
 */
export async function GET(request: Request) {
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) return redirectTo("/login");

  const url = new URL(request.url);
  const organisationId = url.searchParams.get("organisation") ?? "";
  const user = await prisma.user.findUnique({ where: { id: resolved.userId }, select: { role: true } });
  const allowed = user?.role === "super_admin"
    || Boolean(await prisma.membership.findUnique({ where: { organisationId_userId: { organisationId, userId: resolved.userId } }, select: { id: true } }));
  const organisation = allowed ? await prisma.organisation.findFirst({ where: { id: organisationId, archivedAt: null }, select: { slug: true } }) : null;
  if (!organisation) return redirectTo("/");
  await setActiveOrganisationCookie(organisationId);
  return redirectTo(safeNext(url.searchParams.get("next"), orgHomePath(organisation.slug)));
}
