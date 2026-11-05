import { z } from "zod";
import type { Prisma, Status } from "@prisma/client";
import { SHOW_RESOLVED, SHOW_RESOLVED_PARAM } from "@/lib/issue-state";
import { DUPLICATES_PARAM, SHOW_DUPLICATES } from "@/lib/duplicates";
import { issuesPath, type ProjectRef } from "@/lib/project-paths";

/**
 * Milestones (#289): a release or sprint that groups issues and can carry
 * a due date. An issue is in at most one. Closing a milestone leaves its
 * issues alone; deleting one clears their link (ON DELETE SET NULL).
 */

/** `?milestone=` value selecting issues in no milestone. */
export const MILESTONE_NONE = "none";
export const MILESTONE_PARAM = "milestone";

/** Statuses that count as done for a milestone's progress. */
export const DONE_STATUSES: readonly Status[] = ["resolved", "closed"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-31" → that day at 00:00 UTC, or null when blank/invalid. */
export function parseDueDate(raw: string | null | undefined): Date | null | "invalid" {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (!DATE_RE.test(text)) return "invalid";
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return "invalid";
  return date;
}

/** A stored due date (a calendar day) back to "YYYY-MM-DD". */
export function dueDateValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export const milestoneInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Milestone title must be at least 2 characters")
    .max(80, "Milestone title must be at most 80 characters"),
  description: z.string().trim().max(500, "Keep the description to 500 characters or fewer").nullable(),
});

export type MilestoneProgress = { done: number; total: number; percent: number };

export function milestoneProgress(done: number, total: number): MilestoneProgress {
  const safeTotal = Math.max(0, total);
  const safeDone = Math.min(Math.max(0, done), safeTotal);
  return {
    done: safeDone,
    total: safeTotal,
    percent: safeTotal === 0 ? 0 : Math.round((safeDone / safeTotal) * 100),
  };
}

/** Whole days from `today` to `due`, both "YYYY-MM-DD". */
export function daysUntil(due: string, today: string): number {
  const ms = Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export type DueTone = "overdue" | "soon" | "later" | "done";

/** Human wording for a due date relative to `today` (the viewer's day). */
export function dueLabel(
  due: string,
  today: string,
  isClosed = false,
): { text: string; tone: DueTone } {
  if (isClosed) return { text: "Closed", tone: "done" };
  const days = daysUntil(due, today);
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? "" : "s"}`, tone: "overdue" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  if (days <= 7) return { text: `Due in ${days} days`, tone: "soon" };
  return { text: `Due in ${days} days`, tone: "later" };
}

export type MilestoneFilter = { id: string } | "none" | null;

/** Reads `?milestone=`; an id that no longer exists means no filter. */
export function parseMilestoneFilter(
  raw: string | string[] | undefined,
  known: readonly { id: string }[],
): MilestoneFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (value === MILESTONE_NONE) return "none";
  return known.some((m) => m.id === value) ? { id: value } : null;
}

export function milestoneWhere(filter: MilestoneFilter): Prisma.BugWhereInput {
  if (filter === "none") return { milestoneId: null };
  if (filter) return { milestoneId: filter.id };
  return {};
}

/**
 * The issues list showing every issue in one milestone. A milestone counts
 * its resolved, closed and duplicate issues, but the list hides those by
 * default (#1058, #285), so "All N issues" has to ask for them.
 */
export function milestoneIssuesHref(slug: ProjectRef, milestoneId: string): string {
  const params = new URLSearchParams({
    [MILESTONE_PARAM]: milestoneId,
    [SHOW_RESOLVED_PARAM]: SHOW_RESOLVED,
    [DUPLICATES_PARAM]: SHOW_DUPLICATES,
  });
  return issuesPath(slug, "all", params);
}

export function milestoneParamValue(filter: MilestoneFilter): string | undefined {
  if (filter === "none") return MILESTONE_NONE;
  return filter?.id;
}
