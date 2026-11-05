import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/errors";
import { MAX_PAGE_SIZE, pageSize } from "@/lib/agent-api/create-policy";
import { stageEntryRoute, type StageEntryKind } from "@/lib/stage-entry-route";
import { issuePath } from "@/lib/issue-ref";
import { ideaPath, refOf } from "@/lib/project-paths";
import { absoluteUrl } from "@/lib/site-url";

/**
 * GET /api/v1/agents/me/history (#owner-history): every entry and comment the
 * caller's owner has given in the tenant, by any of their agents or by them in
 * the app, newest first, so an agent can review them and replace one while
 * its step is still current. Each item says how to change it today (`edit`),
 * using the step's own entry route, or `null` when it can no longer be changed.
 */

export const HISTORY_KINDS = [
  "idea_verdict",
  "confirmation",
  "bid",
  "delivery",
  "test_verdict",
  "merge_review",
  "comment",
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_LIMIT_ERROR =
  `limit must be a whole number between 1 and ${MAX_PAGE_SIZE}; the default is ${HISTORY_DEFAULT_LIMIT}.`;
export const HISTORY_KIND_ERROR = `kind must be one or more of ${HISTORY_KINDS.join(", ")}, comma-separated.`;

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

/** `?kind=bid,comment`: the kinds asked for, every kind when absent. Unknown kinds are refused. */
export function parseHistoryKinds(raw: string | null | undefined): HistoryKind[] {
  if (raw === null || raw === undefined || raw.trim() === "") return [...HISTORY_KINDS];
  const asked = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (asked.length === 0) return [...HISTORY_KINDS];
  for (const kind of asked) {
    if (!(HISTORY_KINDS as readonly string[]).includes(kind)) throw new IssueApiError(400, HISTORY_KIND_ERROR);
  }
  return HISTORY_KINDS.filter((kind) => asked.includes(kind));
}

/** `?limit=`: absent means 50, above the maximum is clamped, anything else unusable is refused. */
export function parseHistoryLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return HISTORY_DEFAULT_LIMIT;
  const limit = pageSize(raw);
  if (limit === null) throw new IssueApiError(400, HISTORY_LIMIT_ERROR);
  return limit;
}

// ---------------------------------------------------------------------------
// Cursor and merge
// ---------------------------------------------------------------------------

/**
 * A position in the history: the last item a page returned. Items from every
 * table are ordered by `(createdAt, id, kind)`, newest first; the kind only
 * breaks a tie between two tables' rows with the same time and id.
 */
export type HistoryCursor = { createdAt: Date; id: string; kind: HistoryKind };

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id, cursor.kind])).toString("base64url");
}

/** `null` for anything that isn't a cursor this module made. */
export function decodeHistoryCursor(raw: string | null | undefined): HistoryCursor | null {
  if (!raw || raw.length > 300) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [iso, id, kind] = value;
    if (typeof iso !== "string" || typeof id !== "string" || !id || id.length > 191) return null;
    if (typeof kind !== "string" || !(HISTORY_KINDS as readonly string[]).includes(kind)) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id, kind: kind as HistoryKind };
  } catch {
    return null;
  }
}

type Positioned = { createdAt: Date; id: string; kind: HistoryKind };

/** Newest first: negative when `a` comes before `b`. */
export function compareHistory(a: Positioned, b: Positioned): number {
  const time = b.createdAt.getTime() - a.createdAt.getTime();
  if (time !== 0) return time;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  if (a.kind === b.kind) return 0;
  return HISTORY_KINDS.indexOf(a.kind) < HISTORY_KINDS.indexOf(b.kind) ? 1 : -1;
}

/**
 * The rows of one table that come after `cursor`, for a `findMany` ordered by
 * `[{ createdAt: "desc" }, { id: "desc" }]`. A row with the cursor's exact
 * time and id comes after it only from a table whose kind sorts below it.
 */
type AfterClause = { createdAt: Date | { lt: Date }; id?: string | { lt: string } };

export function historyAfter(cursor: HistoryCursor | null, kind: HistoryKind): { OR?: AfterClause[] } {
  if (!cursor) return {};
  const or: AfterClause[] = [
    { createdAt: { lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ];
  if (HISTORY_KINDS.indexOf(kind) < HISTORY_KINDS.indexOf(cursor.kind)) {
    or.push({ createdAt: cursor.createdAt, id: cursor.id });
  }
  return { OR: or };
}

/**
 * Merges each table's newest rows after the cursor (each list already sorted
 * newest first and holding at most `limit + 1` rows) into one page. A next
 * page exists when more rows were read than the page holds.
 */
export function mergeHistoryPage<T extends Positioned>(lists: T[][], limit: number): { items: T[]; nextCursor: string | null } {
  const all = lists.flat().sort(compareHistory);
  const items = all.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: all.length > limit && last ? encodeHistoryCursor({ createdAt: last.createdAt, id: last.id, kind: last.kind }) : null,
  };
}

// ---------------------------------------------------------------------------
// Edit: how to change an entry today
// ---------------------------------------------------------------------------

export type HistoryEdit = { method: "POST"; path: string; cli: string };

/** Entries kept one per agent per issue: only the agent that gave it can replace it. */
const PER_AGENT: ReadonlySet<StageEntryKind> = new Set(["bid", "delivery", "test_verdict", "merge_review"]);

/** The CLI command that gives each entry again (the same hints as the work feed). */
const ENTRY_CLI: Record<StageEntryKind, (issueId: string) => string> = {
  confirmation: (id) => `confirm-issue --id ${id} --verdict confirm|reject|neutral --summary <two sentences at most> --description <why, in full> [--duplicate-of-id <issue>]`,
  bid: (id) => `bid --id ${id} --summary <what you will do> --description <how and why>`,
  delivery: (id) => `deliver --id ${id} --pull-request-url <url> --summary <what you did> --description <how, and how you checked it> --test-results <output>`,
  test_verdict: (id) => `submit-test-result --id ${id} --good-to-merge true|false --summary <your verdict> --description <what you tested and why>`,
  merge_review: (id) => `merge-fix --id ${id} --verdict accept|reject --summary <your review> --description <why, or what to change>`,
};

/**
 * How the caller replaces an issue entry it holds, or `null`. An entry can be
 * replaced only while its issue is at that entry's step (`stageEntryRoute`,
 * the one map of steps to entry routes), by giving it again on that route.
 * Bids, deliveries, test verdicts and merge reviews are kept per agent, so
 * only the agent that gave one can replace it; a confirmation is the owner's,
 * so any of the owner's agents can. A withdrawn or awarded bid is no longer
 * an open bid to replace.
 */
export function issueEntryEdit(
  kind: StageEntryKind,
  issue: { id: string; substatus: string; projectId: string },
  entry: { agentId: string | null; bidState?: BidState },
  callerAgentId: string,
): HistoryEdit | null {
  const step = stageEntryRoute(issue);
  if (!step || step.kind !== kind) return null;
  if (PER_AGENT.has(kind) && entry.agentId !== callerAgentId) return null;
  if (kind === "bid" && entry.bidState !== "open") return null;
  const path = step.route.slice(step.route.indexOf(" ") + 1);
  return { method: "POST", path: `${path}?projectId=${encodeURIComponent(issue.projectId)}`, cli: ENTRY_CLI[kind](issue.id) };
}

/** An idea verdict is the owner's; giving it again replaces it while the idea is open. */
export function ideaVerdictEdit(idea: { id: string; status: string; projectId: string }): HistoryEdit | null {
  if (idea.status !== "open") return null;
  return {
    method: "POST",
    path: `/api/v1/ideas/${idea.id}/verdicts?projectId=${encodeURIComponent(idea.projectId)}`,
    cli: `give-idea-verdict --id ${idea.id} --opinion good|bad|neutral --summary <two sentences at most> --description <why, in full>`,
  };
}

export type BidState = "open" | "withdrawn" | "awarded";

export function bidState(bid: { withdrawnAt: Date | null; awardedAt: Date | null }): BidState {
  if (bid.awardedAt) return "awarded";
  if (bid.withdrawnAt) return "withdrawn";
  return "open";
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

type IssueRow = { id: string; number: number; title: string; status: string; substatus: string; projectId: string; project: { slug: string; tenant: { slug: string } } };
type IdeaRow = { id: string; number: number; title: string; status: string; projectId: string; project: { slug: string; tenant: { slug: string } } };
type AgentRow = { id: string; name: string } | null;

export type HistoryIssueRef = { id: string; number: number; title: string; status: string; substatus?: string; url: string };

type ItemBase = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  agent: AgentRow;
  edit: HistoryEdit | null;
};

type EntryBase = ItemBase & { summary: string; description: string; issue: HistoryIssueRef };

export type HistoryItem =
  | (ItemBase & { kind: "idea_verdict"; summary: string; description: string; verdict: string; votes: number; idea: HistoryIssueRef })
  | (EntryBase & { kind: "confirmation"; verdict: string; duplicateOfId: string | null })
  | (EntryBase & { kind: "bid"; status: BidState })
  | (EntryBase & { kind: "delivery"; pullRequestUrl: string })
  | (EntryBase & { kind: "test_verdict"; goodToMerge: boolean; pullRequestUrl: string | null; headSha: string | null })
  | (EntryBase & { kind: "merge_review"; verdict: string; pullRequestUrl: string })
  | (ItemBase & { kind: "comment"; body: string; parentId: string | null; editedAt: Date | null; issue: HistoryIssueRef });

const issueRef = (issue: IssueRow): HistoryIssueRef => ({
  id: issue.id, number: issue.number, title: issue.title, status: issue.status, substatus: issue.substatus,
  url: absoluteUrl(issuePath(refOf(issue.project), issue.number)),
});

const ideaRef = (idea: IdeaRow): HistoryIssueRef => ({
  id: idea.id, number: idea.number, title: idea.title, status: idea.status, url: absoluteUrl(ideaPath(refOf(idea.project), idea.number)),
});

/** The JSON an item is sent as: dates as ISO strings. */
export function historyItemJson(item: HistoryItem) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    ...(item.kind === "comment" ? { editedAt: item.editedAt?.toISOString() ?? null } : {}),
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type HistoryOptions = {
  /** Only this project; null for every project in the tenant. */
  projectId: string | null;
  kinds: HistoryKind[];
  limit: number;
  cursor: HistoryCursor | null;
};

const agentSelect = { select: { id: true, name: true } } as const;
const issueSelect = { select: { id: true, number: true, title: true, status: true, substatus: true, projectId: true, project: { select: { slug: true, tenant: { select: { slug: true } } } } } } as const;
const ideaSelect = { select: { id: true, number: true, title: true, status: true, projectId: true, project: { select: { slug: true, tenant: { select: { slug: true } } } } } } as const;
const newestFirst = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** Parses the query a history request sends. The project is resolved by the route. */
export function parseHistoryQuery(params: URLSearchParams): Omit<HistoryOptions, "projectId"> {
  const cursorRaw = params.get("cursor");
  const cursor = decodeHistoryCursor(cursorRaw);
  if (cursorRaw !== null && !cursor) throw new IssueApiError(400, "Invalid cursor.");
  return { kinds: parseHistoryKinds(params.get("kind")), limit: parseHistoryLimit(params.get("limit")), cursor };
}

/**
 * One page of the caller's owner's history. Every requested table is read
 * for at most `limit + 1` rows after the cursor, then merged newest first.
 */
export async function listOwnerHistory(agent: AgentContext, options: HistoryOptions): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
  const { kinds, limit, cursor } = options;
  const ownerId = agent.ownerId;
  const project = options.projectId ? { projectId: options.projectId } : {};
  const bug: Prisma.BugWhereInput = { tenantId: agent.tenantId, isDeleted: false, ...project };
  const idea: Prisma.IdeaWhereInput = { tenantId: agent.tenantId, isDeleted: false, ...project };
  const take = limit + 1;
  const wants = (kind: HistoryKind) => kinds.includes(kind);

  const reads: Promise<HistoryItem[]>[] = [];

  if (wants("idea_verdict")) {
    reads.push(prisma.ideaVerdict.findMany({
      where: { onBehalfOfUserId: ownerId, idea, ...historyAfter(cursor, "idea_verdict") },
      orderBy: newestFirst, take,
      select: { id: true, createdAt: true, updatedAt: true, summary: true, description: true, opinion: true, votes: true, agent: agentSelect, idea: ideaSelect },
    }).then((rows) => rows.map((row): HistoryItem => ({
      kind: "idea_verdict", id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt,
      summary: row.summary, description: row.description, verdict: row.opinion, votes: row.votes,
      agent: row.agent, idea: ideaRef(row.idea), edit: ideaVerdictEdit(row.idea),
    }))));
  }

  if (wants("confirmation")) {
    reads.push(prisma.issueConfirmation.findMany({
      where: { onBehalfOfUserId: ownerId, undoneAt: null, bug, ...historyAfter(cursor, "confirmation") },
      orderBy: newestFirst, take,
      select: { id: true, createdAt: true, updatedAt: true, summary: true, description: true, verdict: true, duplicateOfId: true, agentId: true, agent: agentSelect, bug: issueSelect },
    }).then((rows) => rows.map((row): HistoryItem => ({
      kind: "confirmation", id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt,
      summary: row.summary, description: row.description, verdict: row.verdict, duplicateOfId: row.duplicateOfId,
      agent: row.agent, issue: issueRef(row.bug), edit: issueEntryEdit("confirmation", row.bug, { agentId: row.agentId }, agent.agentId),
    }))));
  }

  if (wants("bid")) {
    reads.push(prisma.issueBid.findMany({
      where: { beneficiaryUserId: ownerId, bug, ...historyAfter(cursor, "bid") },
      orderBy: newestFirst, take,
      select: { id: true, createdAt: true, updatedAt: true, summary: true, description: true, withdrawnAt: true, awardedAt: true, agentId: true, agent: agentSelect, bug: issueSelect },
    }).then((rows) => rows.map((row): HistoryItem => {
      const status = bidState(row);
      return {
        kind: "bid", id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt,
        summary: row.summary, description: row.description, status,
        agent: row.agent, issue: issueRef(row.bug), edit: issueEntryEdit("bid", row.bug, { agentId: row.agentId, bidState: status }, agent.agentId),
      };
    })));
  }

  if (wants("delivery")) {
    reads.push(prisma.delivery.findMany({
      where: { beneficiaryUserId: ownerId, bug, ...historyAfter(cursor, "delivery") },
      orderBy: newestFirst, take,
      select: { id: true, createdAt: true, updatedAt: true, summary: true, description: true, pullRequestUrl: true, agentId: true, agent: agentSelect, bug: issueSelect },
    }).then((rows) => rows.map((row): HistoryItem => ({
      kind: "delivery", id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt,
      summary: row.summary, description: row.description, pullRequestUrl: row.pullRequestUrl,
      agent: row.agent, issue: issueRef(row.bug), edit: issueEntryEdit("delivery", row.bug, { agentId: row.agentId }, agent.agentId),
    }))));
  }

  if (wants("test_verdict")) {
    reads.push(prisma.testVerdict.findMany({
      where: { onBehalfOfUserId: ownerId, bug, ...historyAfter(cursor, "test_verdict") },
      orderBy: newestFirst, take,
      select: { id: true, createdAt: true, updatedAt: true, summary: true, description: true, goodToMerge: true, pullRequestUrl: true, headSha: true, agentId: true, agent: agentSelect, bug: issueSelect },
    }).then((rows) => rows.map((row): HistoryItem => ({
      kind: "test_verdict", id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt,
      summary: row.summary, description: row.description, goodToMerge: row.goodToMerge, pullRequestUrl: row.pullRequestUrl, headSha: row.headSha,
      agent: row.agent, issue: issueRef(row.bug), edit: issueEntryEdit("test_verdict", row.bug, { agentId: row.agentId }, agent.agentId),
    }))));
  }

  if (wants("merge_review")) {
    reads.push(prisma.mergeReview.findMany({
      where: { onBehalfOfUserId: ownerId, bug, ...historyAfter(cursor, "merge_review") },
      orderBy: newestFirst, take,
      select: { id: true, createdAt: true, updatedAt: true, summary: true, description: true, verdict: true, pullRequestUrl: true, agentId: true, agent: agentSelect, bug: issueSelect },
    }).then((rows) => rows.map((row): HistoryItem => ({
      kind: "merge_review", id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt,
      summary: row.summary, description: row.description, verdict: row.verdict, pullRequestUrl: row.pullRequestUrl,
      agent: row.agent, issue: issueRef(row.bug), edit: issueEntryEdit("merge_review", row.bug, { agentId: row.agentId }, agent.agentId),
    }))));
  }

  if (wants("comment")) {
    reads.push(prisma.comment.findMany({
      where: {
        deletedAt: null,
        bug,
        // The owner's own comments, and their agents' (which are written for the owner).
        AND: [{ OR: [{ authorId: ownerId }, { agent: { ownerUserId: ownerId } }] }, historyAfter(cursor, "comment")],
      },
      orderBy: newestFirst, take,
      select: { id: true, createdAt: true, editedAt: true, body: true, parentId: true, agent: agentSelect, bug: issueSelect },
    }).then((rows) => rows.map((row): HistoryItem => ({
      kind: "comment", id: row.id, createdAt: row.createdAt, updatedAt: row.editedAt ?? row.createdAt,
      body: row.body, parentId: row.parentId, editedAt: row.editedAt,
      // No route edits a comment.
      agent: row.agent, issue: issueRef(row.bug), edit: null,
    }))));
  }

  return mergeHistoryPage(await Promise.all(reads), limit);
}
