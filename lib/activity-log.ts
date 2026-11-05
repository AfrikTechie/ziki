import type { ActivityType, Prisma, Substatus } from "@prisma/client";
import { stateLabel } from "@/lib/labels";
import { stripMarkdown } from "@/lib/rich-text";

export type ActivityMetadata = {
  field?: string;
  from?: string | null;
  to?: string | null;
  commentPreview?: string;
  commentId?: string;
  /** Resolution note, on the status change into resolved/closed (#316). */
  note?: string;
};

type ActivityInput = {
  bugId: string;
  actorId: string;
  type: ActivityType;
  summary: string;
  metadata?: ActivityMetadata;
};

/** Build Prisma create payloads for one or more activity rows. */
export function activityCreateData(
  entries: ActivityInput[],
): Prisma.BugActivityCreateManyInput[] {
  return entries.map((entry) => ({
    bugId: entry.bugId,
    actorId: entry.actorId,
    type: entry.type,
    summary: entry.summary,
    metadata:
      entry.metadata === undefined
        ? undefined
        : (entry.metadata as Prisma.InputJsonValue),
  }));
}

export function createdSummary(title: string): string {
  return `created this issue (“${truncate(title, 80)}”)`;
}

export function statusChangedSummary(from: Substatus, to: Substatus): string {
  return `changed status from ${stateLabel(from)} to ${stateLabel(to)}`;
}

export function assigneeChangedSummary(
  fromName: string | null,
  toName: string | null,
): string {
  const from = fromName ?? "Unassigned";
  const to = toName ?? "Unassigned";
  return `changed assignee from ${from} to ${to}`;
}

export function typeChangedSummary(
  fromName: string | null,
  toName: string | null,
): string {
  const from = fromName ?? "none";
  const to = toName ?? "none";
  return `changed type from ${from} to ${to}`;
}


export function areaChangedSummary(fromName: string | null, toName: string | null): string {
  return `changed area from ${fromName ?? "none"} to ${toName ?? "none"}`;
}

/**
 * Plain-text version of a comment for the activity log: Markdown removed and
 * `@[Name](userId)` mentions shown as `@Name`, so user ids never leak.
 */
export function commentPreview(body: string, max = 120): string {
  return truncate(stripMarkdown(body), max);
}

export function commentedSummary(body: string): string {
  return `added a comment: “${commentPreview(body)}”`;
}

/** Logged when an admin removes someone else's comment (#150). */
export function commentDeletedSummary(authorName: string): string {
  return `removed a comment by ${authorName}`;
}

export function editedSummary(fields: string[]): string {
  if (fields.length === 0) return "edited this issue";
  if (fields.length === 1) return `edited ${fields[0]}`;
  if (fields.length === 2) return `edited ${fields[0]} and ${fields[1]}`;
  return `edited ${fields.slice(0, -1).join(", ")}, and ${fields.at(-1)}`;
}

export function boostedSummary(): string {
  return "boosted this issue to the top";
}

export function unboostedSummary(): string {
  return "removed boost from this issue";
}

export function deletedSummary(): string {
  return "deleted this issue";
}

export function restoredSummary(): string {
  return "restored this issue";
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}
