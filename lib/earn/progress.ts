import type { EarnTaskProgress, Prisma, PrismaClient } from "@prisma/client";
import { award } from "@/lib/points/award";
import { EARN_TASKS, EARN_WELCOME_FROM, SIGNUP_BONUS, stageForPaid, type EarnStage, type EarnTask, type EarnTaskId } from "@/lib/earn/draft";

/**
 * Earn marketing tasks (#earn-tasks): where a person is on each of the four
 * tasks, and the money for the ones staff confirm.
 *
 * A task goes started, submitted (with proof), then confirmed or rejected by
 * staff. Tasks go in order: the next opens when the one before is confirmed.
 * Only a confirmed task pays, once: the ledger row's `sourceKey` is unique.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Every ledger row an earner's task earns starts with this; the balance sums them. */
export const EARN_KEY_PREFIX = "earn:";

/** Longest proof we keep: a few links or a short paragraph, not an upload. */
export const EARN_PROOF_MAX = 4000;

export function earnSourceKey(userId: string, taskKey: string): string {
  return `${EARN_KEY_PREFIX}${userId}:${taskKey}`;
}

export function taskByNumber(n: number): EarnTask | null {
  return Number.isInteger(n) && n >= 1 && n <= EARN_TASKS.length ? EARN_TASKS[n - 1] : null;
}

/** One task as the earner sees it. */
export type EarnTaskState = "open" | "in-progress" | "in-review" | "paid";

export type EarnTaskRow = Pick<EarnTaskProgress, "taskKey" | "status" | "note"> & Partial<Pick<EarnTaskProgress, "proof">>;

/** The tasks that are confirmed, in the order of the task list. All four are open at once, so any can be done first. */
export function doneTasks(rows: EarnTaskRow[]): EarnTaskId[] {
  const confirmed = new Set(rows.filter((row) => row.status === "confirmed").map((row) => row.taskKey));
  return EARN_TASKS.filter((task) => confirmed.has(task.id)).map((task) => task.id);
}

/** How many tasks are confirmed, whichever they are. */
export function paidCount(rows: EarnTaskRow[]): number {
  return doneTasks(rows).length;
}

export function stageFromRows(rows: EarnTaskRow[]): EarnStage {
  return stageForPaid(paidCount(rows));
}

/** The state of task `index` (0-based), from its own row alone: no task waits on another. */
export function taskStateFor(rows: EarnTaskRow[], index: number): EarnTaskState {
  const row = rows.find((candidate) => candidate.taskKey === EARN_TASKS[index].id);
  if (!row) return "open";
  if (row.status === "confirmed") return "paid";
  return row.status === "submitted" ? "in-review" : "in-progress";
}

const EMAIL = /[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}/gi;

/**
 * How many of a counted task's things the proof lists: the distinct email
 * addresses for Send 10 emails, the filled lines for Research 10 people (one
 * per line, as the form asks). Never more than the task's target.
 */
export function proofCount(task: EarnTask, proof: string | null | undefined): number {
  const text = proof?.trim() ?? "";
  if (!text) return 0;
  if (task.target === 1) return 1;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const emails = new Set((text.match(EMAIL) ?? []).map((address) => address.toLowerCase()));
  const found = task.id === "emails" && emails.size > 0 ? emails.size : lines.length;
  return Math.min(found, task.target);
}

export type EarnTaskProgressView = { task: EarnTask; state: EarnTaskState; done: number; target: number };

/**
 * Where each task really is, for a progress bar: a paid task is full, a task
 * sent for checking counts what its proof lists (a one-off task counts once),
 * and a task not started, still going or rejected counts nothing yet.
 */
export function taskProgress(rows: EarnTaskRow[]): EarnTaskProgressView[] {
  return EARN_TASKS.map((task, index) => {
    const state = taskStateFor(rows, index);
    const row = rows.find((candidate) => candidate.taskKey === task.id);
    const done = state === "paid" ? task.target : state === "in-review" ? proofCount(task, row?.proof) : 0;
    return { task, state, done, target: task.target };
  });
}

/** The first task number (1-based) that has been started and is not paid, or null when none has. */
export function startedFromRows(rows: EarnTaskRow[]): number | null {
  const index = EARN_TASKS.findIndex((_, i) => {
    const state = taskStateFor(rows, i);
    return state === "in-progress" || state === "in-review";
  });
  return index < 0 ? null : index + 1;
}

export async function loadRows(db: Db, userId: string): Promise<EarnTaskProgress[]> {
  return db.earnTaskProgress.findMany({ where: { userId } });
}

/** What the ledger says this earner has earned from tasks. The one source of the balance. */
export async function earnedFromLedger(db: Db, userId: string): Promise<number> {
  const sum = await db.pointEntry.aggregate({
    where: { userId, sourceKey: { startsWith: EARN_KEY_PREFIX } },
    _sum: { points: true },
  });
  return Number(sum._sum.points ?? 0);
}

/**
 * Starts one task: its row is made the first time the earner opens it or presses Start, and not before, so a task
 * nobody has begun has no status. All four are open at once, so starting one touches no other. Does nothing if the
 * task already has a row. Returns whether it started it now.
 */
export async function startTask(db: Db, userId: string, n: number): Promise<boolean> {
  const task = taskByNumber(n);
  if (!task) return false;
  const exists = await db.earnTaskProgress.findUnique({ where: { userId_taskKey: { userId, taskKey: task.id } }, select: { id: true } });
  if (exists) return false;
  await db.earnTaskProgress.upsert({ where: { userId_taskKey: { userId, taskKey: task.id } }, create: { userId, taskKey: task.id }, update: {} });
  return true;
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a task in for checking: any task that isn't paid yet, from started or
 * after a rejection (a resend replaces the proof).
 */
export async function submitTask(db: Db, userId: string, n: number, proofInput: string): Promise<SubmitResult> {
  const task = taskByNumber(n);
  if (!task) return { ok: false, error: "That task doesn't exist." };
  const proof = proofInput.trim();
  if (!proof) return { ok: false, error: "Add what you did, so we can check it." };
  if (proof.length > EARN_PROOF_MAX) return { ok: false, error: `Keep it under ${EARN_PROOF_MAX} characters.` };

  const rows = await loadRows(db, userId);
  if (taskStateFor(rows, n - 1) === "paid") return { ok: false, error: "This task is already paid." };

  await db.earnTaskProgress.upsert({
    where: { userId_taskKey: { userId, taskKey: task.id } },
    create: { userId, taskKey: task.id },
    update: {},
  });
  const { count } = await db.earnTaskProgress.updateMany({
    where: { userId, taskKey: task.id, status: { in: ["started", "rejected"] } },
    data: { status: "submitted", proof, submittedAt: new Date(), decidedAt: null, decidedById: null, note: null },
  });
  return count === 1 ? { ok: true } : { ok: false, error: "This task is already with us for checking." };
}

/**
 * The Earn workspace, where all earn money lives: the $5 welcome and every
 * confirmed task. Never a person's own workspaces, so earn money never counts
 * in their points, leaderboards or totals there. It is made the first time it
 * is needed (an upsert on the unique slug, so two at once make one), and a
 * person does not have to be a member of it.
 */
export async function earnTenantId(db: Db, earnTenantSlug: string): Promise<string> {
  const tenant = await db.tenant.upsert({
    where: { slug: earnTenantSlug },
    create: { slug: earnTenantSlug, name: "Ziki Earn" },
    update: {},
    select: { id: true },
  });
  return tenant.id;
}

/** Whether the account signed up after Earn went live: only those are shown the "$5 awarded" pop-up. */
export async function isNewEarnAccount(db: Db, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  return Boolean(user && user.createdAt >= EARN_WELCOME_FROM);
}

/**
 * The $5 welcome for coming to earn (#earn-welcome): paid once to anyone who
 * opens an earn page, new account or old. It is its own reward, separate from
 * the sign-up bonus the site pays every account. Under the `earn:` key prefix,
 * so the earn balance counts it, and unique per person, so asking again pays
 * nothing. It lands in the Earn workspace only. Returns true when it was paid now.
 */
export async function grantWelcome(db: Db, userId: string, earnTenantSlug: string): Promise<boolean> {
  const sourceKey = `${EARN_KEY_PREFIX}welcome:${userId}`;
  if (await db.pointEntry.findUnique({ where: { sourceKey }, select: { id: true } })) return false;
  const tenantId = await earnTenantId(db, earnTenantSlug);
  return award(db, { tenantId, userId, bugId: null, role: "signup", points: SIGNUP_BONUS, sourceKey, exact: true });
}

export type DecideResult = { ok: true } | { ok: false; error: string };

/**
 * Staff confirm a submitted task: it is marked confirmed and the earner is
 * paid, in one transaction, so a task is never paid without being confirmed
 * or confirmed without being paid. A second confirm finds nothing submitted
 * and does nothing.
 */
export async function confirmTask(
  prisma: PrismaClient,
  args: { userId: string; taskKey: string; staffId: string; earnTenantSlug: string; note?: string },
): Promise<DecideResult> {
  const task = EARN_TASKS.find((candidate) => candidate.id === args.taskKey);
  if (!task) return { ok: false, error: "That task doesn't exist." };
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.earnTaskProgress.updateMany({
      where: { userId: args.userId, taskKey: task.id, status: "submitted" },
      data: { status: "confirmed", decidedAt: new Date(), decidedById: args.staffId, note: args.note?.trim() || null },
    });
    if (count !== 1) return { ok: false as const, error: "Nothing to confirm: it isn't waiting for checking." };
    const tenantId = await earnTenantId(tx, args.earnTenantSlug);
    await award(tx, {
      tenantId,
      userId: args.userId,
      bugId: null,
      // The ledger has no earn role yet; a research job's payout is the closest existing one.
      role: "submission",
      points: task.pay,
      sourceKey: earnSourceKey(args.userId, task.id),
      // Earn pays fixed amounts: a workspace multiplier must not change what a task pays.
      exact: true,
    });
    return { ok: true as const };
  });
}

/** Staff send a submitted task back with a reason; the earner can fix it and send it again. */
export async function rejectTask(db: Db, args: { userId: string; taskKey: string; staffId: string; reason: string }): Promise<DecideResult> {
  const reason = args.reason.trim();
  if (!reason) return { ok: false, error: "Say why, so they know what to fix." };
  const { count } = await db.earnTaskProgress.updateMany({
    where: { userId: args.userId, taskKey: args.taskKey, status: "submitted" },
    data: { status: "rejected", decidedAt: new Date(), decidedById: args.staffId, note: reason },
  });
  return count === 1 ? { ok: true } : { ok: false, error: "Nothing to reject: it isn't waiting for checking." };
}
