import { EARN_PROJECT_SLUG } from "@/lib/earn/draft";

/**
 * Earn (#earn-drafts, Mark's call of 5 Nov): on the earn pages an earner sees only what they came for, so the
 * builders' links (Your App, Marketing, Security) and the leaderboard and workstream icons are left out there.
 * Everyone else, and the earner on any other page, sees the site as it always is.
 */
export function isEarnPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/earn" || pathname.startsWith("/earn/") || pathname.startsWith(`/${EARN_PROJECT_SLUG}/`);
}
