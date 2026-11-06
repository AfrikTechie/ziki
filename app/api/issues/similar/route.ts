import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { bugInOrganisation, currentOrganisationIdFor } from "@/lib/organisation-context";
import { resolveSessionUserId } from "@/lib/session-user";
import { issueHref } from "@/lib/issue-ref";
import { consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import {
  fallbackTerms,
  normalizeQuery,
  pickSimilar,
  shouldSearch,
  SIMILAR_LIMIT,
  SIMILAR_RATE_LIMIT,
  SIMILAR_STATUSES,
  type ScoredIssue,
  type SimilarIssue,
  type SimilarIssueLink,
} from "@/lib/similar-issues";

/** Searched over, then cut to SIMILAR_LIMIT once scored. */
const CANDIDATES = 10;

async function trigramMatches(query: string, organisationId: string | null): Promise<ScoredIssue[]> {
  if (!organisationId) return [];
  // `%` (similarity) and `<%` (the query as a word-run inside the title)
  // are both served by "Bug_title_trgm_idx". Deleted issues and finished
  // ones are left out: nobody is reporting a duplicate of those.
  return prisma.$queryRaw<ScoredIssue[]>`
    SELECT "id", "number", "title", "status", "voteCount",
           GREATEST(similarity("title", ${query}), word_similarity(${query}, "title")) AS "score"
    FROM "Bug"
    WHERE "isDeleted" = false
      AND "track" = 'product'
      AND "organisationId" = ${organisationId}
      AND "status"::text = ANY(${SIMILAR_STATUSES as string[]})
      AND ("title" % ${query} OR ${query} <% "title")
    ORDER BY "score" DESC
    LIMIT ${CANDIDATES}`;
}

// Keep this retrieval in PostgreSQL: Typesense token/infix matches cannot
// guarantee the recall of pg_trgm's `%` and `<%` operators. The established
// score, 0.35 threshold, and vote-count ranking must remain exact until a
// parity-tested candidate strategy is available.

/** Without pg_trgm (the extension needs privileges some hosts lack). */
async function plainMatches(query: string, organisationId: string | null): Promise<SimilarIssue[]> {
  const terms = fallbackTerms(query);
  if (terms.length < 1) return [];
  return prisma.bug.findMany({
    where: {
      ...bugInOrganisation(organisationId),
      ...PRODUCT_TRACK,
      isDeleted: false,
      status: { in: [...SIMILAR_STATUSES] },
      AND: terms.map((t) => ({ title: { contains: t, mode: "insensitive" as const } })),
    },
    select: { id: true, number: true, title: true, status: true, voteCount: true },
    orderBy: [{ voteCount: "desc" }, { updatedAt: "desc" }],
    take: SIMILAR_LIMIT,
  });
}

/**
 * Open issues whose title looks like `?q=` (#284). Signed-in only, rate
 * limited, and never more than the list would show the same person.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveSessionUserId();
  if ("error" in resolved) {
    return NextResponse.json({ error: "Sign in to search issues." }, { status: 401 });
  }
  if (!(await consumeRateLimit(`similar:${resolved.userId}`, SIMILAR_RATE_LIMIT)).allowed) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const query = normalizeQuery(req.nextUrl.searchParams.get("q"));
  if (!shouldSearch(query)) return NextResponse.json({ issues: [] });

  const organisationId = await currentOrganisationIdFor(resolved.userId);
  let issues: SimilarIssue[];
  try {
    issues = pickSimilar(await trigramMatches(query, organisationId));
  } catch (error) {
    console.error("[similar] trigram search failed; using plain matching for this request", error);
    issues = await plainMatches(query, organisationId);
  }

  return NextResponse.json(
    { issues: await withPaths(issues) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Each match with its address, `/<org>/<project>/<number>` (#project-urls). */
async function withPaths(issues: SimilarIssue[]): Promise<SimilarIssueLink[]> {
  if (issues.length === 0) return [];
  const projects = await prisma.bug.findMany({
    where: { id: { in: issues.map((issue) => issue.id) } },
    select: { id: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
  });
  const projectOf = new Map(projects.map((row) => [row.id, row.project]));
  return issues.flatMap((issue) => {
    const project = projectOf.get(issue.id);
    return project ? [{ ...issue, path: issueHref({ number: issue.number, project }) }] : [];
  });
}
