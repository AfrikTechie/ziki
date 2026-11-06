import type { Prisma, PrismaClient } from "@prisma/client";
import { roundPoints } from "./rules";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Every adjustment the points-multiplier script writes has a `sourceKey` that
 * starts with this. An adjustment tops a balance up but is not an action, so
 * counts of what someone did (solved issues) leave it out.
 */
export const MULTIPLIER_KEY_PREFIX = "multiplier:";

/**
 * What an organisation multiplies every award by (#points-multiplier): 1 for a
 * normal organisation. Read each time an award is written, so changing it takes
 * effect on the next award. Anything unreadable counts as 1.
 */
export async function pointsMultiplierFor(db: Db, organisationId: string): Promise<number> {
  if (!db || !("organisation" in db) || !db.organisation?.findUnique) return 1;
  const row = await db.organisation.findUnique({ where: { id: organisationId }, select: { pointsMultiplier: true } });
  const value = row?.pointsMultiplier == null ? 1 : Number(row.pointsMultiplier);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** An amount as the ledger stores it in an organisation with this multiplier. */
export function scaledPoints(points: number, multiplier: number): number {
  return roundPoints(points * multiplier);
}
