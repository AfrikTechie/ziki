import { describe, expect, it, vi } from "vitest";

/**
 * Earn marketing tasks (#earn-tasks): a task pays when staff confirm it, once,
 * and never before. Tasks open in order.
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { confirmTask, grantWelcome, isNewEarnAccount, paidCount, rejectTask, startNextTask, submitTask, taskStateFor } from "@/lib/earn/progress";

type TaskRow = { userId: string; taskKey: string; status: string; proof?: string | null; note?: string | null };
type Where = { userId?: string; taskKey?: string; status?: string | { in: string[] } };

/** An in-memory database with the earn table, the ledger's unique key, and a transaction that rolls back when its callback throws. */
function fakeEarnDb() {
  const state = { tasks: [] as TaskRow[], ledger: [] as Array<Record<string, unknown>>, accountCreatedAt: new Date() };
  const matches = (row: TaskRow, where: Where) =>
    (where.userId === undefined || row.userId === where.userId) &&
    (where.taskKey === undefined || row.taskKey === where.taskKey) &&
    (where.status === undefined || (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status)));
  const db = {
    earnTaskProgress: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) => state.tasks.filter((row) => row.userId === where.userId)),
      upsert: vi.fn(async ({ where, create }: { where: { userId_taskKey: { userId: string; taskKey: string } }; create: { userId: string; taskKey: string } }) => {
        const { userId, taskKey } = where.userId_taskKey;
        if (!state.tasks.some((row) => row.userId === userId && row.taskKey === taskKey)) state.tasks.push({ ...create, status: "started" });
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<TaskRow> }) => {
        const hit = state.tasks.filter((row) => matches(row, where));
        hit.forEach((row) => Object.assign(row, data));
        return { count: hit.length };
      }),
    },
    pointEntry: {
      findUnique: vi.fn(async ({ where }: { where: { sourceKey: string } }) => (state.ledger.some((row) => row.sourceKey === where.sourceKey) ? { id: "e" } : null)),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        let count = 0;
        for (const row of data) {
          if (state.ledger.some((existing) => existing.sourceKey === row.sourceKey)) continue;
          state.ledger.push(row);
          count++;
        }
        return { count };
      }),
    },
    user: { findUnique: vi.fn(async () => ({ createdAt: state.accountCreatedAt })) },
    // The Earn workspace is made on first use; every earn credit goes there, whatever workspaces the person is in.
    tenant: { upsert: vi.fn(async () => ({ id: "tenant-earn" })) },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const before = { tasks: state.tasks.map((row) => ({ ...row })), ledger: [...state.ledger] };
      try {
        return await callback(db);
      } catch (error) {
        state.tasks = before.tasks;
        state.ledger = before.ledger;
        throw error;
      }
    }),
  };
  return { state, db: db as never };
}

const confirm = (db: never, taskKey = "who") => confirmTask(db, { userId: "earner", taskKey, staffId: "staff", earnTenantSlug: "ziki-earn" });

describe("earn tasks (#earn-tasks)", () => {
  it("pays a confirmed task its amount once, in the Earn workspace only, however often staff confirm", async () => {
    const { state, db } = fakeEarnDb();
    expect(await submitTask(db, "earner", 1, "Bakeries in Lagos")).toEqual({ ok: true });
    expect(await confirm(db)).toEqual({ ok: true });
    expect((await confirm(db)).ok).toBe(false);
    expect(state.ledger).toEqual([expect.objectContaining({ tenantId: "tenant-earn", userId: "earner", role: "submission", points: 3, sourceKey: "earn:earner:who" })]);
    expect(state.tasks[0].status).toBe("confirmed");
  });

  it("pays nothing for a task that was never sent in", async () => {
    const { state, db } = fakeEarnDb();
    await startNextTask(db, "earner");
    expect((await confirm(db)).ok).toBe(false);
    expect(state.ledger).toEqual([]);
  });

  it("opens tasks in order: a later task cannot be sent in, or counted, before the one before is confirmed", async () => {
    const { state, db } = fakeEarnDb();
    expect(await submitTask(db, "earner", 2, "ten businesses")).toEqual({ ok: false, error: expect.any(String) });
    expect(state.tasks).toEqual([]);
    expect(paidCount([{ taskKey: "research", status: "confirmed", note: null }])).toBe(0);
    expect(taskStateFor([], 1)).toBe("locked");
  });

  it("sends a task back with a reason, lets it be sent again, and refuses a send-back with no reason", async () => {
    const { state, db } = fakeEarnDb();
    await submitTask(db, "earner", 1, "x");
    expect((await rejectTask(db, { userId: "earner", taskKey: "who", staffId: "staff", reason: "  " })).ok).toBe(false);
    expect(await rejectTask(db, { userId: "earner", taskKey: "who", staffId: "staff", reason: "Too vague" })).toEqual({ ok: true });
    expect(state.tasks[0]).toMatchObject({ status: "rejected", note: "Too vague" });
    expect(await submitTask(db, "earner", 1, "Bakeries in Lagos without a website")).toEqual({ ok: true });
    expect(state.tasks[0]).toMatchObject({ status: "submitted", note: null });
    expect(state.ledger).toEqual([]);
  });

  it("pays the $5 welcome once to anyone who comes to earn, in the Earn workspace and no other", async () => {
    const { state, db } = fakeEarnDb();
    expect(await grantWelcome(db, "earner", "ziki-earn")).toBe(true);
    expect(await grantWelcome(db, "earner", "ziki-earn")).toBe(false);
    expect(state.ledger).toEqual([expect.objectContaining({ tenantId: "tenant-earn", userId: "earner", role: "signup", points: 5, sourceKey: "earn:welcome:earner" })]);
  });

  it("pays the welcome to an account made long ago too, once", async () => {
    const { state, db } = fakeEarnDb();
    expect(await grantWelcome(db, "old-timer", "ziki-earn")).toBe(true);
    expect(await grantWelcome(db, "old-timer", "ziki-earn")).toBe(false);
    expect(state.ledger).toHaveLength(1);
  });

  it("tells a new account from one made before Earn went live, for the pop-up only", async () => {
    const { state, db } = fakeEarnDb();
    expect(await isNewEarnAccount(db, "newcomer")).toBe(true);
    state.accountCreatedAt = new Date("2026-10-01T00:00:00.000Z");
    expect(await isNewEarnAccount(db, "old-timer")).toBe(false);
    // The money is not tied to it: the older account still gets the $5.
    expect(await grantWelcome(db, "old-timer", "ziki-earn")).toBe(true);
  });

  it("starts the next task once, however often it is asked", async () => {
    const { state, db } = fakeEarnDb();
    expect(await startNextTask(db, "earner")).toBe(1);
    expect(await startNextTask(db, "earner")).toBeNull();
    expect(state.tasks).toHaveLength(1);
  });
});
