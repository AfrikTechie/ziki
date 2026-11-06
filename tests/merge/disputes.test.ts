import { describe, expect, it, vi } from "vitest";
import {
  ALREADY_RESOLVED,
  DISPUTE_ALREADY_OPEN,
  NOT_IN_ORGANISATION,
  NOT_YOUR_ENTRY,
  correctionSourceKey,
  correctEntry,
  grantMissingAward,
  openDispute,
  rejectDispute,
  type DisputeInput,
  type DisputeRow,
} from "@/lib/points/disputes";

/** Points disputes (#622): members dispute only their own entries in their own organisation, one open dispute at a time; resolving one grants or corrects exactly once. */
/** The fake `award()` ledger: same unique-by-sourceKey rule as Postgres. */
function fakeLedger() {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    pointEntry: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        let count = 0;
        for (const row of data) {
          if (rows.some((existing) => existing.sourceKey === row.sourceKey)) continue;
          rows.push(row);
          count += 1;
        }
        return { count };
      }),
      update: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
      findFirst: vi.fn(
        async (
          args: { where: Record<string, unknown> },
        ): Promise<{ id: string; correctedAt?: Date | null } | null> => {
          void args;
          return null;
        },
      ),
      findUnique: vi.fn(async (): Promise<{ id: string; correctedAt?: Date | null } | null> => null),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
    },
    pointDispute: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "dispute-new",
        ...data,
      })),
      update: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
    },
    bug: {
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
    },
  };
  return { rows, db: db as never, raw: db };
}

const ORGANISATION = "organisation-a";
const OTHER_ORGANISATION = "organisation-b";
const ME = "user-me";
const ADMIN = "user-admin";

const bugOn = {
  id: "bug-1",
  number: 42,
  organisationId: ORGANISATION,
  reporterId: ME,
  assigneeId: "user-solver",
};

function openDisputeRow(overrides: Partial<DisputeRow> = {}): DisputeRow {
  return {
    id: "dispute-1",
    organisationId: ORGANISATION,
    userId: ME,
    bugId: bugOn.id,
    pointEntryId: null,
    status: "open",
    ...overrides,
  };
}

describe("openDispute", () => {
  const input: DisputeInput = {
    bugNumber: 42,
    kind: "missing",
    role: "solver",
    reason: "I resolved it but got nothing.",
  };

  it("rejects a bug from another organisation", async () => {
    const { db } = fakeLedger();
    const result = await openDispute(db, { organisationId: OTHER_ORGANISATION, userId: ME, input });
    expect(result).toEqual({ ok: false, error: NOT_IN_ORGANISATION });
  });

  it("rejects disputing a points entry that isn't yours", async () => {
    const { db, raw } = fakeLedger();
    raw.bug.findFirst.mockResolvedValue({ id: "bug-1" });
    raw.pointEntry.findFirst.mockResolvedValue(null);
    const result = await openDispute(db, {
      organisationId: ORGANISATION,
      userId: ME,
      input: { bugNumber: 42, kind: "wrong", pointEntryId: "entry-x", reason: "Wrong amount." },
    });
    expect(result).toEqual({ ok: false, error: NOT_YOUR_ENTRY });
  });

  it("rejects disputing an entry when an open dispute is already pending (#622)", async () => {
    const { db, raw } = fakeLedger();
    raw.bug.findFirst.mockResolvedValue({ id: "bug-1" });
    raw.pointEntry.findFirst.mockResolvedValue({ id: "entry-1", correctedAt: null });
    raw.pointDispute.findFirst.mockResolvedValue({ id: "dispute-existing" });
    const result = await openDispute(db, {
      organisationId: ORGANISATION,
      userId: ME,
      input: { bugNumber: 42, kind: "wrong", pointEntryId: "entry-1", reason: "Wrong amount." },
    });
    expect(result).toEqual({ ok: false, error: DISPUTE_ALREADY_OPEN });
  });

});

describe("grantMissingAward", () => {
  it("grants the missing solver award once", async () => {
    const { db, raw } = fakeLedger();
    const result = await grantMissingAward(db, {
      dispute: openDisputeRow(),
      bug: bugOn,
      role: "solver",
      resolvedById: ADMIN,
    });
    expect(result).toEqual({ ok: true, awarded: true });
    expect(raw.pointEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            role: "solver",
            // #rewards: the issue's reward; $1 before any estimate.
            points: 1,
            sourceKey: "solver:bug-1:user-solver",
          }),
        ],
      }),
    );
    expect(raw.pointDispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dispute-1" },
        data: expect.objectContaining({ status: "granted", resolvedById: ADMIN }),
      }),
    );
  });

  it("granting twice does not add points twice", async () => {
    // A race: both grants see the dispute still open, but the ledger's unique
    // sourceKey keeps the points honest.
    const { db, rows } = fakeLedger();
    const first = await grantMissingAward(db, {
      dispute: openDisputeRow(),
      bug: bugOn,
      role: "solver",
      resolvedById: ADMIN,
    });
    const second = await grantMissingAward(db, {
      dispute: openDisputeRow(),
      bug: bugOn,
      role: "solver",
      resolvedById: ADMIN,
    });
    expect(first).toEqual({ ok: true, awarded: true });
    expect(second).toEqual({ ok: true, awarded: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ points: 1 });
  });

  it("refuses to resolve a dispute that is already resolved", async () => {
    const { db, rows } = fakeLedger();
    const result = await grantMissingAward(db, {
      dispute: openDisputeRow({ status: "granted" }),
      bug: bugOn,
      role: "solver",
      resolvedById: ADMIN,
    });
    expect(result).toEqual({ ok: false, error: ALREADY_RESOLVED });
    expect(rows).toHaveLength(0);
  });

});

describe("correctEntry", () => {
  const entry = {
    id: "entry-1",
    organisationId: ORGANISATION,
    userId: ME,
    bugId: "bug-1" as string | null,
    role: "solver" as const,
    points: 25,
  };

  it("marks the entry corrected and writes the reversing row", async () => {
    const { db, raw, rows } = fakeLedger();
    const result = await correctEntry(db, {
      dispute: openDisputeRow({ pointEntryId: "entry-1" }),
      entry,
      resolvedById: ADMIN,
      note: "It was a low, not a medium.",
    });
    expect(result).toEqual({ ok: true, awarded: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      points: -25,
      sourceKey: correctionSourceKey("entry-1"),
    });
    expect(raw.pointEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "entry-1" },
        data: { correctedAt: expect.any(Date) },
      }),
    );
    expect(raw.pointDispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "granted",
          resolution: "It was a low, not a medium.",
        }),
      }),
    );
  });

  it("multiple calls to correct the same entry are idempotent and never double-deduct (#622)", async () => {
    const { db, rows } = fakeLedger();
    const first = await correctEntry(db, {
      dispute: openDisputeRow({ id: "dispute-1", pointEntryId: "entry-1" }),
      entry,
      resolvedById: ADMIN,
    });
    expect(first).toEqual({ ok: true, awarded: true });

    // A concurrent second dispute resolution on the same entry:
    const second = await correctEntry(db, {
      dispute: openDisputeRow({ id: "dispute-2", pointEntryId: "entry-1" }),
      entry,
      resolvedById: ADMIN,
    });
    expect(second).toEqual({ ok: true, awarded: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ points: -25, sourceKey: "undo:entry-1" });
  });
});

describe("rejectDispute", () => {
  it("rejects an open dispute without touching the ledger", async () => {
    const { db, raw, rows } = fakeLedger();
    const result = await rejectDispute(db, {
      dispute: openDisputeRow(),
      resolvedById: ADMIN,
      note: "The award is already there.",
    });
    expect(result).toEqual({ ok: true, disputeId: "dispute-1" });
    expect(rows).toHaveLength(0);
    expect(raw.pointDispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rejected", resolution: "The award is already there." }),
      }),
    );
  });

});
