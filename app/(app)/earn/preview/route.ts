import { NextResponse, type NextRequest } from "next/server";
import { EARN_PREVIEW_COOKIE, EARN_STAGES, earnPreviewEnabled, type EarnStage } from "@/lib/earn/draft";

/**
 * Development only (#earn-tasks): shows every earn page at a demo stage (new,
 * a few tasks paid, all four paid, unlocked) by setting a cookie, then opens
 * `next` (a path on this site) or Withdraw. "new" clears the cookie and goes
 * back to the signed-in person's real data. It does nothing in production: the
 * page is not found.
 */
export function GET(request: NextRequest) {
  if (!earnPreviewEnabled()) return new NextResponse("Not found", { status: 404 });
  const state = request.nextUrl.searchParams.get("state") as EarnStage | null;
  const next = request.nextUrl.searchParams.get("next");
  const to = request.nextUrl.clone();
  to.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/earn/withdraw";
  to.search = request.nextUrl.searchParams.get("celebrate") === "1" ? "?celebrate=1" : "";
  const response = NextResponse.redirect(to);
  if (state && state !== "new" && EARN_STAGES.includes(state)) {
    response.cookies.set(EARN_PREVIEW_COOKIE, state, { path: "/", sameSite: "lax", httpOnly: true });
  } else {
    response.cookies.delete(EARN_PREVIEW_COOKIE);
  }
  return response;
}
