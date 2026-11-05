import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BASE_PATH } from "@/lib/base-path";
import { resolveSessionUserId } from "@/lib/session-user";
import { projectFirstTarget } from "@/lib/project-route";

/** A relative Location, so the browser stays on the host it asked (see projects/[slug]/open, #416). */
function redirectTo(path: string, status = 307): NextResponse {
  return new NextResponse(null, { status, headers: { Location: `${BASE_PATH}${path}` } });
}

/**
 * An address from before organisations were in URLs (#project-urls):
 * middleware.ts sends `/<project>/ideas/42` or `/<project>/740` here as `?to=`.
 * It finds the project among the viewer's organisations and sends them on to
 * `/<org>/<project>/…`; an issue that moved project then redirects again to
 * its own. Nothing found goes to the person's home.
 */
export async function GET(request: Request) {
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) return redirectTo("/login");
  const to = new URL(request.url).searchParams.get("to") ?? "";
  if (!to.startsWith("/") || to.startsWith("//") || to.includes("\\")) return redirectTo("/home");

  const user = await prisma.user.findUnique({ where: { id: resolved.userId }, select: { id: true, role: true } });
  const target = user ? await projectFirstTarget(user, to) : null;
  return target ? redirectTo(target, 308) : redirectTo("/home");
}
