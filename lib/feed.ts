import { PRODUCT_TRACK } from "@/lib/marketing/track";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { defaultProjectIdFor } from "@/lib/organisation-context";
import { projectAreaFilterWhere } from "@/lib/project-area-filter";

export type FeedCursor = { after: string; afterId: string };
/** The historical page size, kept as the default so pollers are not broken. */
export const FEED_PAGE_SIZE = 50;
/** Documented ceiling; a larger `limit` is clamped to this rather than rejected. */
export const FEED_MAX_PAGE_SIZE = 100;

export class FeedInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const timestampSchema = z.iso.datetime({ offset: true });

/**
 * `limit` was documented for /feed but ignored (#469). A missing value keeps
 * the old page size, a number is clamped to 1..100, and anything that is not a
 * whole number of at least 1 is a caller error rather than a silent fallback.
 */
export function parseFeedLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null) return FEED_PAGE_SIZE;
  const trimmed = raw.trim();
  const n = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : 0;
  if (n < 1) {
    throw new FeedInputError(
      `limit must be a whole number between 1 and ${FEED_MAX_PAGE_SIZE}; the default is ${FEED_PAGE_SIZE}.`,
      422,
    );
  }
  return Math.min(n, FEED_MAX_PAGE_SIZE);
}

export function parseFeedCursor(params: URLSearchParams): FeedCursor | null {
  const after = params.get("after");
  const afterId = params.get("afterId");
  if (after === null && afterId === null) return null;
  if (!after || !afterId) {
    throw new FeedInputError("Supply both after (an ISO timestamp) and afterId.");
  }
  // #465: both were sent, so say what is actually wrong with `after`.
  if (!timestampSchema.safeParse(after).success) {
    throw new FeedInputError("after must be an ISO-8601 timestamp with a time and offset, e.g. 2026-10-21T00:00:00.000Z.");
  }
  return { after: new Date(after).toISOString(), afterId };
}

export function feedWhere(organisationId: string, projectId: string, cursor: FeedCursor | null, area: string | null = null): Prisma.BugWhereInput {
  return {
    organisationId, projectId, ...PRODUCT_TRACK, isDeleted: false,
    ...projectAreaFilterWhere(area),
    ...(cursor ? { OR: [
      { createdAt: { gt: new Date(cursor.after) } },
      { createdAt: new Date(cursor.after), id: { gt: cursor.afterId } },
    ] } : {}),
  };
}

/**
 * Resolve only projects inside the caller's organisation; never trust a supplied id.
 * An empty or whitespace-only `projectId` (e.g. `?projectId=` built from an
 * unset variable) means "not given", so it falls back to the default project
 * as documented instead of looking up a project with id "" (#470).
 */
export async function feedProject(organisationId: string, requested?: string | null) {
  const given = requested?.trim() || null;
  const id = given ?? await defaultProjectIdFor(prisma, organisationId);
  if (!id) return null;
  return prisma.project.findFirst({ where: { id, organisationId }, select: { id: true, name: true } });
}

export async function readFeed(organisationId: string, projectId: string, cursor: FeedCursor | null, area: string | null = null, limit: number = FEED_PAGE_SIZE) {
  const pageSize = Math.min(Math.max(Math.trunc(limit) || FEED_PAGE_SIZE, 1), FEED_MAX_PAGE_SIZE);
  const rows = await prisma.bug.findMany({
    where: feedWhere(organisationId, projectId, cursor, area),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: pageSize + 1,
    select: { id: true, number: true, title: true, status: true, createdAt: true, projectId: true, areaId: true },
  });
  const issues = rows.slice(0, pageSize);
  const last = issues.at(-1);
  return {
    issues,
    nextCursor: last ? { after: last.createdAt.toISOString(), afterId: last.id } : cursor,
    hasMore: rows.length > pageSize,
  };
}
