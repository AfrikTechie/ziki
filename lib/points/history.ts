import type { Prisma, PrismaClient } from "@prisma/client";
import { pointsNumber, TARGET_POINTS } from "@/lib/points/rules";

/**
 * PointEntry history for the Overview "Your points" chart.
 * Buckets ledger rows by day / week / month / year without touching the
 * leaderboard module or the schema.
 */

export type PointsGranularity = "daily" | "weekly" | "monthly" | "yearly";

export type PointHistoryEntry = {
  createdAt: Date;
  points: number;
};

export type PointsBucket = {
  /** Inclusive start of the bucket (UTC). */
  start: Date;
  /** Exclusive end of the bucket (UTC). */
  end: Date;
  /** Short label for the chart axis. */
  label: string;
  points: number;
};

export type PointsSeries = {
  granularity: PointsGranularity;
  caption: string;
  /** Weekly view draws a dashed target line; other ranges leave this 0. */
  target: number;
  buckets: PointsBucket[];
  total: number;
};

/** Same points goal the product uses; weekly chart treats it as a week target. */
export const WEEKLY_POINTS_TARGET = TARGET_POINTS;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Monday 00:00 UTC of the ISO week that contains `date`. */
export function startOfIsoWeek(date: Date): Date {
  const day = startOfUtcDay(date);
  const weekday = day.getUTCDay(); // 0 Sun … 6 Sat
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return new Date(day.getTime() + offset * DAY_MS);
}

export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function startOfUtcYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function addUtcYears(date: Date, years: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear() + years, 0, 1));
}

function dayLabel(date: Date): string {
  return `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()]}`;
}

function weekLabel(date: Date): string {
  return dayLabel(date);
}

function monthLabel(date: Date): string {
  return MONTH_SHORT[date.getUTCMonth()];
}

function yearLabel(date: Date): string {
  return String(date.getUTCFullYear());
}

export function captionFor(granularity: PointsGranularity): string {
  switch (granularity) {
    case "daily":
      return "Points earned each day, last 7 days";
    case "weekly":
      return "Points earned each week, last 8 weeks · 500 pts required, more is welcome";
    case "monthly":
      return "Points earned each month, last 12 months";
    case "yearly":
      return "Points earned each year";
  }
}

export function defaultWindow(
  granularity: PointsGranularity,
  now = new Date(),
): { from: Date; to: Date } {
  const today = startOfUtcDay(now);
  const to = addUtcDays(today, 1); // exclusive end of today
  switch (granularity) {
    case "daily":
      return { from: addUtcDays(today, -6), to };
    case "weekly": {
      const thisWeek = startOfIsoWeek(today);
      return { from: addUtcDays(thisWeek, -7 * 7), to };
    }
    case "monthly": {
      const thisMonth = startOfUtcMonth(today);
      return { from: addUtcMonths(thisMonth, -11), to };
    }
    case "yearly": {
      const thisYear = startOfUtcYear(today);
      return { from: addUtcYears(thisYear, -4), to };
    }
  }
}

type BucketCursor = {
  start: Date;
  end: Date;
  label: string;
  next: (start: Date) => Date;
};

function cursorAt(granularity: PointsGranularity, at: Date): BucketCursor {
  switch (granularity) {
    case "daily": {
      const start = startOfUtcDay(at);
      return {
        start,
        end: addUtcDays(start, 1),
        label: dayLabel(start),
        next: (s) => addUtcDays(s, 1),
      };
    }
    case "weekly": {
      const start = startOfIsoWeek(at);
      return {
        start,
        end: addUtcDays(start, 7),
        label: weekLabel(start),
        next: (s) => addUtcDays(s, 7),
      };
    }
    case "monthly": {
      const start = startOfUtcMonth(at);
      return {
        start,
        end: addUtcMonths(start, 1),
        label: monthLabel(start),
        next: (s) => addUtcMonths(s, 1),
      };
    }
    case "yearly": {
      const start = startOfUtcYear(at);
      return {
        start,
        end: addUtcYears(start, 1),
        label: yearLabel(start),
        next: (s) => addUtcYears(s, 1),
      };
    }
  }
}

/**
 * Build an unbroken series of buckets covering [from, to), summing entry
 * points into each. Empty buckets stay (value 0) so the chart shows gaps.
 */
export function buildPointsSeries(input: {
  entries: ReadonlyArray<PointHistoryEntry>;
  granularity: PointsGranularity;
  from?: Date | null;
  to?: Date | null;
  now?: Date;
}): PointsSeries {
  const now = input.now ?? new Date();
  const defaults = defaultWindow(input.granularity, now);
  const from = input.from ? startOfUtcDay(input.from) : defaults.from;
  let toExclusive = input.to
    ? addUtcDays(startOfUtcDay(input.to), 1)
    : defaults.to;
  if (toExclusive <= from) {
    toExclusive = addUtcDays(from, 1);
  }

  let cursor = cursorAt(input.granularity, from);
  while (cursor.end <= from) {
    const nextStart = cursor.next(cursor.start);
    cursor = cursorAt(input.granularity, nextStart);
  }

  const buckets: PointsBucket[] = [];
  while (cursor.start < toExclusive) {
    buckets.push({
      start: cursor.start,
      end: cursor.end,
      label: cursor.label,
      points: 0,
    });
    const nextStart = cursor.next(cursor.start);
    if (nextStart.getTime() === cursor.start.getTime()) break;
    cursor = cursorAt(input.granularity, nextStart);
  }

  for (const entry of input.entries) {
    const at = entry.createdAt.getTime();
    if (at < from.getTime() || at >= toExclusive.getTime()) continue;
    for (const bucket of buckets) {
      if (at >= bucket.start.getTime() && at < bucket.end.getTime()) {
        bucket.points += entry.points;
        break;
      }
    }
  }

  const total = buckets.reduce((sum, b) => sum + b.points, 0);
  return {
    granularity: input.granularity,
    caption: captionFor(input.granularity),
    target: input.granularity === "weekly" ? WEEKLY_POINTS_TARGET : 0,
    buckets,
    total,
  };
}

/** Sum of points with createdAt in [from, toExclusive). */
export function sumPointsInRange(
  entries: ReadonlyArray<PointHistoryEntry>,
  from: Date,
  toExclusive: Date,
): number {
  let total = 0;
  const start = from.getTime();
  const end = toExclusive.getTime();
  for (const entry of entries) {
    const at = entry.createdAt.getTime();
    if (at >= start && at < end) total += entry.points;
  }
  return total;
}

/** Points earned in the ISO week that contains `now`. */
export function pointsThisWeek(
  entries: ReadonlyArray<PointHistoryEntry>,
  now = new Date(),
): number {
  const start = startOfIsoWeek(now);
  return sumPointsInRange(entries, start, addUtcDays(start, 7));
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Load ledger rows for the signed-in member. Corrections (negative points)
 * are included so the chart matches the real balance.
 */
export async function loadPointHistory(
  db: Db,
  scope: { organisationId: string; userId: string },
  opts?: { from?: Date; to?: Date },
): Promise<PointHistoryEntry[]> {
  const where: Prisma.PointEntryWhereInput = {
    organisationId: scope.organisationId,
    userId: scope.userId,
  };
  if (opts?.from || opts?.to) {
    where.createdAt = {
      ...(opts.from ? { gte: opts.from } : {}),
      ...(opts.to ? { lt: opts.to } : {}),
    };
  }
  const rows = await db.pointEntry.findMany({
    where,
    select: { createdAt: true, points: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({ createdAt: row.createdAt, points: pointsNumber(row.points) }));
}
