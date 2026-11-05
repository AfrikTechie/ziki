import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeProjectIdFor } from "@/lib/project-context";
import { consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { escapeSearchQuery } from "@/lib/search";
import { parseIssueNumberQuery } from "@/lib/issue-number";
import { issueHref } from "@/lib/issue-ref";
import { resolveSessionUserId } from "@/lib/session-user";
import { bugInTenant, currentTenantIdFor } from "@/lib/tenant-context";
import {
  normalizeSuggestQuery,
  shouldSuggest,
  SUGGEST_LIMIT,
  SUGGEST_RATE_LIMIT,
  type IssueSuggestion,
} from "@/lib/issue-suggest";

/**
 * Issue titles matching `?q=`, for the search box's autocomplete (#671).
 * Same limits as the list the suggestions come from: signed-in only, the
 * searcher's tenant and project, and no deleted issues.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) {
    return NextResponse.json({ error: "Sign in to search issues." }, { status: 401 });
  }
  if (!(await consumeRateLimit(`suggest:${resolved.userId}`, SUGGEST_RATE_LIMIT)).allowed) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const query = normalizeSuggestQuery(req.nextUrl.searchParams.get("q"));
  if (!shouldSuggest(query)) return NextResponse.json({ issues: [] });

  const tenantId = await currentTenantIdFor(resolved.userId);
  if (!tenantId) return NextResponse.json({ issues: [] });
  const projectId = await activeProjectIdFor(prisma, tenantId);

  const contains = escapeSearchQuery(query);
  const matches: Prisma.BugWhereInput[] = [
    { title: { contains, mode: "insensitive" } },
  ];
  // "#42" and "42" should suggest issue 42 as well as any title containing it.
  const asNumber = parseIssueNumberQuery(query);
  if (asNumber !== null) matches.push({ number: asNumber });

  try {
    const rows = await prisma.bug.findMany({
      where: {
        ...bugInTenant(tenantId),
        ...(projectId ? { projectId } : {}),
        isDeleted: false,
        OR: matches,
      },
      select: { id: true, number: true, title: true, status: true, project: { select: { slug: true, tenant: { select: { slug: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: SUGGEST_LIMIT,
    });
    const issues: IssueSuggestion[] = rows.map(({ project, ...issue }) => ({ ...issue, path: issueHref({ number: issue.number, project }) }));
    return NextResponse.json(
      { issues },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[issues/suggest] search failed", error);
    return NextResponse.json({ error: "Could not search issues." }, { status: 500 });
  }
}
