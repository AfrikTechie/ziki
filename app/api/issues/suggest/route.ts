import { parseTrackFilter, trackFilter } from "@/lib/marketing/track";
import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeProjectIdFor } from "@/lib/project-context";
import { consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { escapeSearchQuery } from "@/lib/search";
import { searchWorkItems } from "@/lib/search-index";
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

  const parsedTrack = parseTrackFilter(req.nextUrl.searchParams.get("track"));
  if (!parsedTrack.ok) {
    return NextResponse.json({ error: "invalid_request", field: "track" }, { status: 400 });
  }

  const query = normalizeSuggestQuery(req.nextUrl.searchParams.get("q"));
  if (!shouldSuggest(query)) return NextResponse.json({ issues: [] });

  const tenantId = await currentTenantIdFor(resolved.userId);
  if (!tenantId) return NextResponse.json({ issues: [] });
  const projectId = await activeProjectIdFor(prisma, tenantId);

  const contains = escapeSearchQuery(query);
  // "#42" and "42" should suggest issue 42 as well as any title containing it.
  const asNumber = parseIssueNumberQuery(query);
  try {
    let candidateIds: string[];
    const postgresCandidates = async () => {
      const matches: Prisma.BugWhereInput[] = [{ title: { contains, mode: "insensitive" } }];
      if (asNumber !== null) matches.push({ number: asNumber });
      const fallback = await prisma.bug.findMany({
        where: { ...bugInTenant(tenantId), ...(projectId ? { projectId } : {}), ...trackFilter(parsedTrack.track), isDeleted: false, OR: matches },
        select: { id: true }, orderBy: { updatedAt: "desc" }, take: SUGGEST_LIMIT,
      });
      return fallback.map((row) => row.id);
    };
    const usedPostgresCandidates = query.length < 3;
    if (usedPostgresCandidates) {
      candidateIds = await postgresCandidates();
    } else try {
      const [text, exact] = await Promise.all([
        searchWorkItems({ query, kind: "bug", tenantId, ...(projectId ? { projectId } : {}), track: parsedTrack.track, page: 1, perPage: 250, queryBy: "title(infix:always)", sortBy: "updatedAt:desc" }),
        asNumber === null ? Promise.resolve({ hits: [] as Array<{ id: string }> }) : searchWorkItems({ query: "*", kind: "bug", tenantId, ...(projectId ? { projectId } : {}), track: parsedTrack.track, page: 1, perPage: 5, queryBy: "title", sortBy: "updatedAt:desc", extraFilters: [`number:=${asNumber}`] }),
      ]);
      candidateIds = [...new Set([...text.hits.map((hit) => hit.id), ...exact.hits.map((hit) => hit.id)])];
      if (candidateIds.length === 0) candidateIds = await postgresCandidates();
    } catch (error) {
      console.error("[issues/suggest] Typesense unavailable; using PostgreSQL search", error);
      candidateIds = await postgresCandidates();
    }
    let rows = await prisma.bug.findMany({
      where: {
        ...bugInTenant(tenantId),
        ...(projectId ? { projectId } : {}),
        ...trackFilter(parsedTrack.track),
        isDeleted: false,
        id: { in: candidateIds },
      },
      select: { id: true, number: true, title: true, status: true, track: true, project: { select: { slug: true, tenant: { select: { slug: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: SUGGEST_LIMIT,
    });
    // Typesense's infix matching may include candidates that the previous
    // PostgreSQL `contains` query would not. Keep suggestions behavior exact;
    // if a candidate fails revalidation, refill from the source-of-truth query.
    const validRows = rows.filter((row) => row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || row.number === asNumber);
    if (validRows.length !== rows.length || (!usedPostgresCandidates && rows.length < SUGGEST_LIMIT)) {
      const fallbackIds = await postgresCandidates();
      rows = await prisma.bug.findMany({
        where: {
          ...bugInTenant(tenantId),
          ...(projectId ? { projectId } : {}),
          ...trackFilter(parsedTrack.track),
          isDeleted: false,
          id: { in: fallbackIds },
        },
        select: { id: true, number: true, title: true, status: true, track: true, project: { select: { slug: true, tenant: { select: { slug: true } } } } },
        orderBy: { updatedAt: "desc" },
        take: SUGGEST_LIMIT,
      });
    }
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
