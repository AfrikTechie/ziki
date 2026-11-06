import { prisma } from "@/lib/prisma";
import { EARN_REF_COOKIE, EARN_REF_MAX_AGE, recordOpen } from "@/lib/earn/outreach";

/**
 * A business's own link from an earner's email (#earn-outreach): ziki.dev/r/<code>. Opening it counts once
 * more for that business, so the earner sees who opened their email, and leaves a note in the browser for 30
 * days so a sign-up that follows can be traced back to it. Then it sends the visitor to Ziki's home page. An
 * unknown code goes there too, with no note. The redirect is a path, not an absolute URL: behind the proxy the
 * request's own address is the server's internal one.
 */
export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const safe = /^[a-z0-9]{4,16}$/.test(code) ? code : null;
  const known = safe ? await recordOpen(prisma, safe).catch((error) => { console.error("[earn] link open failed", error); return false; }) : false;
  const headers = new Headers({ Location: "/", "Cache-Control": "no-store" });
  if (known && safe) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    headers.append("Set-Cookie", `${EARN_REF_COOKIE}=${safe}; Path=/; Max-Age=${EARN_REF_MAX_AGE}; SameSite=Lax; HttpOnly${secure}`);
  }
  return new Response(null, { status: 307, headers });
}
