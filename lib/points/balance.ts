import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { pointsNumber } from "./rules";

/**
 * Reading a person's balance straight off the ledger (#618).
 *
 * A balance is only ever the sum of their `PointEntry` rows inside one organisation:
 * corrections included, nothing derived from the issue tables. That keeps it
 * reproducible — the same rows always give the same number — which is what a
 * later token transfer would have to start from.
 *
 * `lifetime` is every row up to now. `period` is the same sum bounded by
 * `from`/`to` when they are given, and identical to `lifetime` when they are
 * not, so a caller that doesn't care about periods still gets one shape back.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type PointPeriodTotals = {
  points: number;
  entries: number;
  /** Inclusive lower bound, ISO-8601. Null: unbounded. */
  from: string | null;
  /** Inclusive upper bound, ISO-8601. Null: unbounded (up to now). */
  to: string | null;
};

export type PointBalance = {
  lifetime: PointPeriodTotals;
  period: PointPeriodTotals;
};

export type PointBalanceQuery = {
  organisationId: string;
  userId: string;
  /** Inclusive lower bound on `PointEntry.createdAt`. */
  from?: Date | string | null;
  /** Inclusive upper bound on `PointEntry.createdAt`. */
  to?: Date | string | null;
};

const timestamp = z.string().datetime({ offset: true });
const dateBound = z.union([timestamp, z.string().date()]);

/** A bound the caller supplied, as a Date, or null. Rejects anything unparseable, non-ISO, or impossible calendar dates. */
function bound(value: Date | string | null | undefined, field: "from" | "to"): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${field} must be a valid date.`);
    }
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!dateBound.safeParse(trimmed).success) {
      throw new Error(`${field} must be a valid date.`);
    }
    const isDateOnly = trimmed.length === 10;
    const dateStr = isDateOnly
      ? (field === "to" ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`)
      : trimmed;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${field} must be a valid date.`);
    }
    return date;
  }
  throw new Error(`${field} must be a valid date.`);
}

async function totals(
  db: Db,
  where: Prisma.PointEntryWhereInput,
): Promise<{ points: number; entries: number }> {
  const [sum, count] = await Promise.all([
    db.pointEntry.aggregate({ where, _sum: { points: true } }),
    db.pointEntry.count({ where }),
  ]);
  return { points: pointsNumber(sum._sum.points), entries: count };
}

/** `userId`'s balance in `organisationId`, plus the same sum over `from`/`to`. */
export async function pointBalance(db: Db, query: PointBalanceQuery): Promise<PointBalance> {
  const { organisationId, userId } = query;
  const from = bound(query.from, "from");
  const to = bound(query.to, "to");
  if (from && to && from.getTime() > to.getTime()) {
    throw new Error("from must not be after to.");
  }

  const base = { organisationId, userId } satisfies Prisma.PointEntryWhereInput;
  const isBounded = from !== null || to !== null;
  const periodWhere: Prisma.PointEntryWhereInput = isBounded
    ? {
        ...base,
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      }
    : base;

  const [lifetime, bounded] = await Promise.all([
    totals(db, base),
    isBounded ? totals(db, periodWhere) : Promise.resolve(null),
  ]);
  const period = bounded ?? lifetime;

  return {
    lifetime: { ...lifetime, from: null, to: null },
    period: {
      ...period,
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    },
  };
}
