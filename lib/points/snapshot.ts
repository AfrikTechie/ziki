import { createHash, createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { csvRow } from "@/lib/csv";
import { pointsNumber } from "./rules";

/**
 * Point balances as a signed, reproducible snapshot (#618).
 *
 * The ledger already is append-only, so a balance at a cutoff is a pure
 * function of the rows written by then: sum every PointEntry in the organisation
 * with `createdAt <= cutoff`, order the people by id, serialize, hash, sign.
 * Running it again for the same cutoff with the same rows produces the same
 * bytes and therefore the same hash — nothing here records a wall-clock
 * "generated at", which would make every run look different.
 *
 * This is preparation for points becoming transferable, not a token: no chain,
 * no keys, only an HMAC over the content with a server-side secret.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type SnapshotRow = {
  userId: string;
  name: string;
  points: number;
  entries: number;
  walletAddress: string | null;
};

export type PointsSnapshot = {
  organisationId: string;
  /** Inclusive upper bound on `PointEntry.createdAt`, ISO-8601. */
  cutoff: string;
  /** Ordered by `userId`, ascending by code unit, so the order never varies. */
  rows: SnapshotRow[];
};

/** Thrown when POINTS_EXPORT_SECRET is missing; the caller reports it as a configuration error. */
export class PointsExportSecretError extends Error {
  readonly code = "points_export_secret_missing" as const;
  constructor() {
    super("POINTS_EXPORT_SECRET is not set. Set it to a random secret (openssl rand -base64 32) to sign balance exports.");
    this.name = "PointsExportSecretError";
  }
}

/** The HMAC key for export signatures. Never hard-coded; read from the environment. */
export function pointsExportSecret(): string {
  const secret = process.env.POINTS_EXPORT_SECRET;
  if (!secret) throw new PointsExportSecretError();
  return secret;
}

/** Balances in `organisationId` summed from the ledger up to and including `cutoff`. */
export async function buildPointsSnapshot(
  db: Db,
  input: { organisationId: string; cutoff: Date },
): Promise<PointsSnapshot> {
  const { organisationId, cutoff } = input;
  const groups = await db.pointEntry.groupBy({
    by: ["userId"],
    where: { organisationId, createdAt: { lte: cutoff } },
    _sum: { points: true },
    _count: { _all: true },
  });

  const users = await db.user.findMany({
    where: { id: { in: groups.map((group) => group.userId) } },
    select: { id: true, name: true, walletAddress: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));

  const rows = groups.flatMap((group) => {
    const user = byId.get(group.userId);
    if (!user) return [];
    return [{
      userId: user.id,
      name: user.name,
      points: pointsNumber(group._sum.points),
      entries: group._count._all,
      walletAddress: user.walletAddress,
    }];
  });
  rows.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  return { organisationId, cutoff: cutoff.toISOString(), rows };
}

/**
 * The exact bytes the hash and signature cover, serialized with a fixed key
 * order so two runs can't disagree over property insertion order.
 */
export function snapshotContent(snapshot: PointsSnapshot): string {
  return JSON.stringify({
    organisationId: snapshot.organisationId,
    cutoff: snapshot.cutoff,
    rows: snapshot.rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      points: row.points,
      entries: row.entries,
      walletAddress: row.walletAddress,
    })),
  });
}

/** SHA-256 over `snapshotContent`, hex-encoded. */
export function snapshotHash(snapshot: PointsSnapshot): string {
  return createHash("sha256").update(snapshotContent(snapshot), "utf8").digest("hex");
}

/** HMAC-SHA256 of the content hash with the export secret, hex-encoded. */
export function snapshotSignature(input: { hash: string; secret: string }): string {
  return createHmac("sha256", input.secret).update(input.hash).digest("hex");
}

/** The JSON file: the snapshot plus its hash and signature, so it verifies itself. */
export function snapshotJson(
  snapshot: PointsSnapshot,
  signed: { hash: string; signature: string },
): string {
  return `${JSON.stringify(
    {
      version: 1,
      organisationId: snapshot.organisationId,
      cutoff: snapshot.cutoff,
      rows: snapshot.rows,
      contentHash: signed.hash,
      signature: signed.signature,
    },
    null,
    2,
  )}\n`;
}

const CSV_COLUMNS = ["user_id", "name", "points", "entries", "wallet_address"] as const;

/** The CSV file: the same rows, in the same order as the JSON. */
export function snapshotCsv(snapshot: PointsSnapshot): string {
  let csv = csvRow(CSV_COLUMNS);
  for (const row of snapshot.rows) {
    csv += csvRow([row.userId, row.name, row.points, row.entries, row.walletAddress]);
  }
  return csv;
}
