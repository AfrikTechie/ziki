import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EARN_PREVIEW_COOKIE, EARN_STAGES, EARN_WELCOME_SEEN_COOKIE, EARN_TASKS, EARN_WORKSPACE_SLUG, earnBalance, earnPreviewEnabled, tasksPaid, type EarnBalance, type EarnStage } from "@/lib/earn/draft";
import { earnedFromLedger, grantWelcome, isNewEarnAccount, loadRows, stageFromRows, startedFromRows, startNextTask, type EarnTaskRow } from "@/lib/earn/progress";
import { earnAgentWhere } from "@/lib/earn/earner";

/**
 * Where an earner is (#earn-tasks), read from the database: their task rows
 * give the stage and the task they have started, and the points ledger gives
 * the balance.
 *
 * In development only, the preview cookie (/earn/preview?state=…) overrides
 * this with a demo stage so every page can be shown at every step. It is
 * ignored in production.
 */
async function previewStage(): Promise<EarnStage | null> {
  if (!earnPreviewEnabled()) return null;
  const value = (await cookies()).get(EARN_PREVIEW_COOKIE)?.value as EarnStage | undefined;
  return value && EARN_STAGES.includes(value) ? value : null;
}

export type EarnState = {
  stage: EarnStage;
  balance: EarnBalance;
  /** The task number the earner has started (1-based), or null. */
  started: number | null;
  rows: EarnTaskRow[];
};

export async function earnState(userId: string): Promise<EarnState> {
  const preview = await previewStage();
  if (preview) {
    const rows: EarnTaskRow[] = EARN_TASKS.slice(0, tasksPaid(preview)).map((task) => ({ taskKey: task.id, status: "confirmed", note: null }));
    return { stage: preview, balance: earnBalance(preview), started: null, rows };
  }
  // The $5 welcome is paid the first time someone is here, before the balance is read.
  await grantWelcome(prisma, userId, EARN_WORKSPACE_SLUG);
  const [rows, earned] = await Promise.all([loadRows(prisma, userId), earnedFromLedger(prisma, userId)]);
  const stage = stageFromRows(rows);
  return { stage, balance: earnBalance(stage, earned), started: startedFromRows(rows), rows };
}

/**
 * Whether to show the "$5 has been awarded for signing up" pop-up: only to someone who signed up after Earn went
 * live, and only until they dismiss it in this browser. Everyone gets the $5 in their balance (paid here, once);
 * an older account just sees the money, with no pop-up. Never in the demo.
 */
export async function showEarnWelcome(userId: string): Promise<boolean> {
  if (await previewStage()) return false;
  // Paid before anything says so: a no-op when it was already paid.
  await grantWelcome(prisma, userId, EARN_WORKSPACE_SLUG);
  if ((await cookies()).get(EARN_WELCOME_SEEN_COOKIE)?.value) return false;
  return isNewEarnAccount(prisma, userId);
}

export async function earnStage(userId: string): Promise<EarnStage> {
  return (await earnState(userId)).stage;
}

export async function earnBalanceFor(userId: string): Promise<EarnBalance> {
  return (await earnState(userId)).balance;
}

/** The task number the earner has started (1-based), or null. */
export async function startedTask(userId: string): Promise<number | null> {
  return (await earnState(userId)).started;
}

/**
 * Once someone has a connected agent, their next task starts on its own: the
 * agent gets going straight away. Called by the earn pages before they read
 * the state; an upsert, so visiting twice starts nothing twice. Not in demo
 * preview, which writes nothing.
 */
/**
 * Marketing and Open source are for someone whose agent is connected, because the agent does the work.
 * Anyone else goes back to /earn, where "Connect my agent" is, and cannot start a task until it is done.
 */
export async function requireEarnAgent(userId: string): Promise<void> {
  if (await previewStage()) return;
  const agent = await prisma.agent.findFirst({ where: earnAgentWhere(userId), select: { id: true } });
  if (!agent) redirect("/earn/agent");
}

export async function startIfAgentConnected(userId: string): Promise<void> {
  if (await previewStage()) return;
  const agent = await prisma.agent.findFirst({ where: earnAgentWhere(userId), select: { id: true } });
  if (agent) await startNextTask(prisma, userId);
}
