import type { Prisma, PrismaClient } from "@prisma/client";
import { projectPath, refOf, type ProjectRef } from "@/lib/project-paths";

/**
 * Readable issue references (#457). An issue lives at `/<org>/<project>/<number>`
 * (#project-urls). A reference is its per-organisation number, a prefixed
 * form such as `ZE-123`, or its internal id. Numbers are unique per tenant
 * (`@@unique([tenantId, number])`), so a number only means something inside
 * the viewer's organisation.
 */
export type IssueRef = { kind: "number"; number: number } | { kind: "id"; id: string };

const NUMBER = /^[0-9]{1,9}$/;
const PREFIXED = /^[A-Za-z][A-Za-z0-9]{0,9}-([0-9]{1,9})$/;

export function parseIssueRef(raw: string): IssueRef {
  let value = raw.trim();
  try {
    value = decodeURIComponent(value).trim();
  } catch {
    // A malformed escape is just an id that will not be found.
  }
  const prefixed = PREFIXED.exec(value);
  const digits = prefixed ? prefixed[1] : NUMBER.test(value) ? value : null;
  if (digits !== null) {
    const number = Number(digits);
    if (Number.isSafeInteger(number) && number > 0) return { kind: "number", number };
  }
  return { kind: "id", id: value };
}

/**
 * The address of an issue: its organisation and project and its
 * organisation-wide number, e.g. `/zedu/desktop/123` or `.../123/history` (#project-urls).
 */
export function issuePath(ref: ProjectRef, number: number, suffix = ""): string {
  return projectPath(ref, `/${number}${suffix}`);
}

/** The address of an issue read with `project: { select: { slug: true, tenant: { select: { slug: true } } } }`. */
export function issueHref(issue: { number: number; project: { slug: string; tenant: { slug: string } } }, suffix = ""): string {
  return issuePath(refOf(issue.project), issue.number, suffix);
}


type Scope = { tenantId?: Prisma.BugWhereInput["tenantId"] };
type Db = Pick<PrismaClient, "bug"> | Prisma.TransactionClient;

/**
 * Resolves a route reference to the issue's internal id and number inside
 * `scope`. A number needs a tenant: without one it is ambiguous across
 * organisations, so it resolves to nothing. An id keeps the old lookup, scope
 * included, so authorization is the same as before.
 */
export async function resolveIssueRef(
  db: Db,
  ref: IssueRef,
  scope: Scope,
): Promise<{ id: string; number: number } | null> {
  if (ref.kind === "number") {
    if (!scope.tenantId) return null;
    return db.bug.findFirst({ where: { number: ref.number, tenantId: scope.tenantId }, select: { id: true, number: true } });
  }
  return db.bug.findUnique({ where: { id: ref.id, ...scope }, select: { id: true, number: true } });
}

/**
 * The internal id a route's `{id}` names inside a tenant (#457): an id as it
 * is, a readable number (`123`, `ZE-123`) looked up in the tenant. Null when
 * no issue there has that number. Every `/api/v1/issues/{id}` route takes
 * either; the caller still scopes its own read by tenant and project.
 */
export async function issueIdFor(db: Db, raw: string, tenantId: string): Promise<string | null> {
  const ref = parseIssueRef(raw);
  if (ref.kind === "id") return ref.id;
  return (await resolveIssueRef(db, ref, { tenantId }))?.id ?? null;
}

/** `?a=1&b=2` from a page's searchParams, or "" when there are none. */
export function queryString(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, item);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
