import { describe, expect, it, vi } from "vitest";

/**
 * Earn marketing tasks (#earn-tasks): a task pays when staff confirm it, once,
 * and never before. Tasks open in order.
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { giveEarnVerdict, listEarnTasksToCheck } from "@/lib/earn/review";
import { outreachProof, parseResearch, recordOpen, setSent, syncReferral } from "@/lib/earn/outreach";
import { confirmTask, grantWelcome, isNewEarnAccount, paidCount, rejectTask, doneTasks, startTask, submitTask, taskStateFor } from "@/lib/earn/progress";

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
      createMany: vi.fn(async ({ data }: { data: Array<{ userId: string; taskKey: string }> }) => {
        let count = 0;
        for (const row of data) {
          if (state.tasks.some((existing) => existing.userId === row.userId && existing.taskKey === row.taskKey)) continue;
          state.tasks.push({ ...row, status: "started" });
          count++;
        }
        return { count };
      }),
      findUnique: vi.fn(async ({ where }: { where: { userId_taskKey: { userId: string; taskKey: string } } }) =>
        state.tasks.find((row) => row.userId === where.userId_taskKey.userId && row.taskKey === where.userId_taskKey.taskKey) ? { id: "t" } : null),
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
    await startTask(db, "earner", 1);
    expect((await confirm(db)).ok).toBe(false);
    expect(state.ledger).toEqual([]);
  });

  it("opens all four tasks at once: any can be sent in and paid first, each on its own", async () => {
    const { state, db } = fakeEarnDb();
    expect(await submitTask(db, "earner", 2, "ten businesses")).toEqual({ ok: true });
    expect(await confirm(db, "research")).toEqual({ ok: true });
    expect(state.ledger).toEqual([expect.objectContaining({ points: 2, sourceKey: "earn:earner:research" })]);
    const rows = state.tasks.map((row) => ({ taskKey: row.taskKey, status: row.status as "confirmed", note: null }));
    expect(doneTasks(rows)).toEqual(["research"]);
    expect(paidCount(rows)).toBe(1);
    // Nothing waits on another task: the ones not started are open, the paid one is paid.
    expect([0, 1, 2, 3].map((i) => taskStateFor(rows, i))).toEqual(["open", "paid", "open", "open"]);
    expect(await submitTask(db, "earner", 4, "https://x.com/me/status/1")).toEqual({ ok: true });
  });

  it("refuses to send in a task that is already paid", async () => {
    const { db } = fakeEarnDb();
    await submitTask(db, "earner", 1, "x");
    await confirm(db);
    expect(await submitTask(db, "earner", 1, "again")).toEqual({ ok: false, error: expect.any(String) });
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

  it("starts a task only when it is opened, once, and touches no other: an unopened task has no row and so no status", async () => {
    const { state, db } = fakeEarnDb();
    expect(await startTask(db, "earner", 3)).toBe(true);
    expect(await startTask(db, "earner", 3)).toBe(false);
    expect(state.tasks).toEqual([expect.objectContaining({ taskKey: "emails", status: "started" })]);
    const rows = state.tasks.map((row) => ({ taskKey: row.taskKey, status: row.status as "started", note: null }));
    expect([0, 1, 2, 3].map((i) => taskStateFor(rows, i))).toEqual(["open", "open", "in-progress", "open"]);
  });
});

/** A manager agent's verdict on Earn tasks (#earn-agent-review): advice for the person who decides, never a payment. */
describe("manager agent verdicts on earn tasks (#earn-agent-review)", () => {
  type Row = { id: string; userId: string; taskKey: string; status: string; proof: string | null; submittedAt: Date | null; agentVerdict?: string | null; agentReason?: string | null; agentConfidence?: number | null; agentVerdictById?: string | null };
  function fakeReviewDb(rows: Row[]) {
    const pointEntry = { createMany: vi.fn(), create: vi.fn() };
    const db = {
      earnTaskProgress: {
        findMany: vi.fn(async ({ where }: { where: { status: string; userId: { not: string } } }) => rows.filter((row) => row.status === where.status && row.userId !== where.userId.not)),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((row) => row.id === where.id)!, data)),
      },
      pointEntry,
    };
    return { db: db as never, pointEntry };
  }
  const manager = { agentId: "agent-max", ownerId: "staff", tenantId: "tenant-earn" };
  const sent = (id: string, userId: string, status = "submitted"): Row => ({ id, userId, taskKey: "who", status, proof: "Bakeries in Lagos", submittedAt: new Date() });

  it("records a verdict as advice only: the task stays waiting for a person and nothing is paid", async () => {
    const rows = [sent("t1", "earner")];
    const { db, pointEntry } = fakeReviewDb(rows);
    expect(await giveEarnVerdict(db, manager, "tenant-earn", "t1", { verdict: "ready", reason: "One kind of business, with where and why.", confidence: 86 })).toMatchObject({ verdict: "ready", status: "submitted" });
    expect(rows[0]).toMatchObject({ status: "submitted", agentVerdict: "ready", agentConfidence: 86, agentVerdictById: "agent-max" });
    expect(pointEntry.createMany).not.toHaveBeenCalled();
    expect(pointEntry.create).not.toHaveBeenCalled();
  });

  it("refuses its own owner's task, an agent outside Ziki Earn, a task not waiting, and a confidence out of range", async () => {
    const rows = [sent("own", "staff"), sent("paid", "earner", "confirmed"), sent("t1", "earner")];
    const { db } = fakeReviewDb(rows);
    const ok = { verdict: "send_back" as const, reason: "Only 6 of 10.", confidence: 90 };
    await expect(giveEarnVerdict(db, manager, "tenant-earn", "own", ok)).rejects.toMatchObject({ status: 403 });
    await expect(giveEarnVerdict(db, { ...manager, tenantId: "tenant-other" }, "tenant-earn", "t1", ok)).rejects.toMatchObject({ status: 403 });
    await expect(giveEarnVerdict(db, manager, "tenant-earn", "paid", ok)).rejects.toMatchObject({ status: 409 });
    await expect(giveEarnVerdict(db, manager, "tenant-earn", "t1", { ...ok, confidence: 140 })).rejects.toThrow();
    expect(rows[2].agentVerdict).toBeUndefined();
  });

  it("lists the tasks waiting for checking with their checklist, leaving out its own owner's", async () => {
    const { db } = fakeReviewDb([sent("own", "staff"), sent("t1", "earner"), sent("paid", "earner", "confirmed")]);
    const tasks = await listEarnTasksToCheck(db, manager, "tenant-earn");
    expect(tasks.map((task) => task.id)).toEqual(["t1"]);
    expect(tasks[0].task.checklist.length).toBeGreaterThan(0);
  });
});

/** Send 10 emails (#earn-outreach): each business gets its own link that counts who opened it. */
describe("earn email task outreach (#earn-outreach)", () => {
  it("reads the businesses from the research answer, one per line, with an email or website, no repeats, at most 10", () => {
    const list = parseResearch("1. Dainty Affairs, Ikeja, bakemycake@daintyaffairs.com\n- Cakes By Tegz, Ikeja, cakesbytegz.com\nDainty Affairs, again\n\n" + Array.from({ length: 12 }, (_, i) => `Bakery ${i}`).join("\n"));
    expect(list[0]).toEqual({ name: "Dainty Affairs", contact: "bakemycake@daintyaffairs.com" });
    expect(list[1]).toEqual({ name: "Cakes By Tegz", contact: "cakesbytegz.com" });
    expect(list).toHaveLength(10);
  });

  it("ticks only the earner's own businesses, and counts every open of a link", async () => {
    const rows = [{ id: "c1", userId: "earner", code: "abc1234", openedAt: null as Date | null, opens: 0, sentAt: null as Date | null }];
    const db = {
      earnContact: {
        updateMany: vi.fn(async ({ where, data }: { where: { id: string; userId: string }; data: { sentAt: Date | null } }) => {
          const hit = rows.filter((row) => row.id === where.id && row.userId === where.userId);
          hit.forEach((row) => Object.assign(row, data));
          return { count: hit.length };
        }),
        findUnique: vi.fn(async ({ where }: { where: { code: string } }) => rows.find((row) => row.code === where.code) ?? null),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { opens: { increment: number }; openedAt?: Date } }) => {
          const row = rows.find((candidate) => candidate.id === where.id)!;
          row.opens += data.opens.increment;
          if (data.openedAt) row.openedAt = data.openedAt;
        }),
      },
    } as never;
    expect(await setSent(db, "someone-else", "c1", true)).toBe(false);
    expect(await setSent(db, "earner", "c1", true)).toBe(true);
    expect(await recordOpen(db, "abc1234")).toBe(true);
    expect(await recordOpen(db, "abc1234")).toBe(true);
    expect(await recordOpen(db, "nope000")).toBe(false);
    expect(rows[0]).toMatchObject({ opens: 2, openedAt: expect.any(Date), sentAt: expect.any(Date) });
  });

  it("sends in only the businesses ticked sent, noting who opened their link", () => {
    const proof = outreachProof([
      { name: "Dainty Affairs", contact: "a@b.co", sentAt: new Date(), opens: 1 },
      { name: "Not sent yet", contact: null, sentAt: null, opens: 0 },
    ]);
    expect(proof).toBe("Dainty Affairs, a@b.co (opened the link)");
  });
});

/** A sign-up through a business's link (#earn-outreach): traced back once, only for a new account, then its first project. */
describe("earn sign-ups through a link (#earn-outreach)", () => {
  function fakeReferralDb(opts: { userCreatedAt: Date; owned: number }) {
    const contact = { id: "c1", userId: "earner", code: "abc1234", signedUpUserId: null as string | null, signedUpAt: null as Date | null, startedAt: null as Date | null, openedAt: new Date("2026-11-01T10:00:00Z"), createdAt: new Date("2026-10-30T10:00:00Z") };
    const db = {
      earnContact: {
        findUnique: vi.fn(async ({ where }: { where: { code?: string; signedUpUserId?: string } }) =>
          where.code ? (where.code === contact.code ? contact : null) : contact.signedUpUserId === where.signedUpUserId ? contact : null),
        update: vi.fn(async ({ data }: { data: Partial<typeof contact> }) => Object.assign(contact, data)),
      },
      user: { findUnique: vi.fn(async () => ({ createdAt: opts.userCreatedAt })) },
      membership: { count: vi.fn(async () => opts.owned) },
    };
    return { db: db as never, contact };
  }

  it("ticks Signed up for an account made after the link was opened, and Started once it owns a workspace", async () => {
    const { db, contact } = fakeReferralDb({ userCreatedAt: new Date("2026-11-02T09:00:00Z"), owned: 1 });
    await syncReferral(db, "new-business", "abc1234", "tenant-earn");
    expect(contact).toMatchObject({ signedUpUserId: "new-business", signedUpAt: expect.any(Date), startedAt: expect.any(Date) });
  });

  it("doesn't count an account that existed before the link was opened, or the earner themselves", async () => {
    const old = fakeReferralDb({ userCreatedAt: new Date("2026-01-01T00:00:00Z"), owned: 1 });
    await syncReferral(old.db, "old-user", "abc1234", "tenant-earn");
    expect(old.contact.signedUpUserId).toBeNull();
    const self = fakeReferralDb({ userCreatedAt: new Date("2026-11-02T09:00:00Z"), owned: 1 });
    await syncReferral(self.db, "earner", "abc1234", "tenant-earn");
    expect(self.contact.signedUpUserId).toBeNull();
  });
});
