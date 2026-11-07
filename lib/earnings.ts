import { Prisma, type PointRole, type PrismaClient } from "@prisma/client";
import { pointsNumber } from "@/lib/points/rules";
import { issueHref } from "@/lib/issue-ref";

/**
 * Earnings (#earnings): what a person and their agents have earned on every project they work on, read straight off
 * the ledger. A balance is the sum of their `PointEntry` rows (lib/points/balance.ts), corrections included; here it
 * is summed across every organisation, old Ziki Earn entries too, so nobody's money drops when Earn folds into Ziki.
 *
 * "Being checked" is money already won but held on a live issue until enough people report it deployed
 * (lib/points/payout.ts): it is not in the ledger yet, so it is not in the total.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export { WITHDRAW_THRESHOLD } from "@/lib/earnings-threshold";

/** The weekly goal until a person sets their own. */
export const DEFAULT_WEEKLY_GOAL = 50;
/** The largest weekly goal a person can set. */
export const MAX_WEEKLY_GOAL = 100_000;

/** The start of this week: Monday 00:00 UTC, the same for everyone. */
export function startOfWeek(now = new Date()): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

/** Days left in this week, today included. */
export function daysLeftInWeek(now = new Date()): number {
  return 7 - ((now.getUTCDay() + 6) % 7);
}

/**
 * Where a person stands on their own weekly goal (#earnings): what is still to earn, what that needs per day for
 * the days left, and whether they are on pace (where they should be by today, if the goal were spread evenly).
 */
export function weeklyGoalState(earnedThisWeek: number, goal: number, now = new Date()) {
  const daysLeft = daysLeftInWeek(now);
  const left = Math.max(0, goal - earnedThisWeek);
  const shouldBe = (goal * (7 - daysLeft + 1)) / 7;
  return {
    left,
    perDay: left / daysLeft,
    daysLeft,
    shouldBe: Math.min(goal, shouldBe),
    reached: earnedThisWeek >= goal,
    onPace: earnedThisWeek >= shouldBe,
  };
}

/** Reads the weekly goal a person typed: a positive amount of dollars, at most two decimals. Null when it isn't one. */
export function parseWeeklyGoal(raw: unknown): number | null {
  const text = typeof raw === "string" ? raw.trim().replace(/^\$/, "").replace(/,/g, "") : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 && value <= MAX_WEEKLY_GOAL ? value : null;
}

/** What a person has earned: in one workspace when `organisationId` is given, else across every one. */
export async function totalEarned(db: Db, userId: string, organisationId: string | null = null): Promise<number> {
  const sum = await db.pointEntry.aggregate({ where: { userId, ...(organisationId ? { organisationId } : {}) }, _sum: { points: true } });
  return pointsNumber(sum._sum.points);
}

/** Payments for doing the work, as opposed to posting it: what shows someone is a worker (#earnings). */
export const WORK_ROLES: PointRole[] = ["solver", "reviewer", "triager", "submission", "dispatcher", "plan"];

/**
 * The header's $ and Withdraw (#earnings, Mark's call): "on every project once someone has shown they're a worker,
 * including projects they were invited to, but not to people who only post projects." Shown once someone has been
 * paid for work (solving, reviewing, confirming, research answers, dispatching, an approved plan) or has joined a
 * project from Discover. Posting ideas, verdicts, votes, upvoted comments and the sign-up bonus don't count. Null
 * hides it.
 */
export async function headerEarnings(db: Db, userId: string, organisationId: string | null = null): Promise<number | null> {
  const [entry, joined] = await Promise.all([
    db.pointEntry.findFirst({ where: { userId, role: { in: WORK_ROLES }, points: { gt: 0 } }, select: { id: true } }),
    db.projectMembership.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  if (!entry && !joined) return null;
  // What you earned in the workspace you're in (Chloe's call); Withdraw still shows your total.
  return entry ? totalEarned(db, userId, organisationId) : 0;
}

/** A held award, as lib/points/payout.ts keeps it on the issue. */
type HeldAward = { userId?: unknown; points?: unknown };

/** Money won on live issues that is waiting for the deploy reports before it is paid. */
export async function beingChecked(db: Db, userId: string, organisationId: string | null = null): Promise<number> {
  const bugs = await db.bug.findMany({
    where: { payoutReleasedAt: null, heldPayout: { not: Prisma.AnyNull }, ...(organisationId ? { organisationId } : {}) },
    select: { heldPayout: true },
    take: 500,
  });
  let held = 0;
  for (const bug of bugs) {
    if (!Array.isArray(bug.heldPayout)) continue;
    for (const award of bug.heldPayout as HeldAward[]) {
      if (award && award.userId === userId && typeof award.points === "number") held += award.points;
    }
  }
  return held;
}

/** Where the money came from, in the few groups a person thinks in. Order is the bar's order. */
export const SOURCE_GROUPS = [
  { key: "solved", label: "Solved issues", roles: ["solver", "dispatcher", "submission", "plan"] },
  { key: "reviews", label: "Accepted reviews", roles: ["reviewer"] },
  { key: "confirmations", label: "Confirmations", roles: ["triager"] },
  { key: "reported", label: "Reported ideas", roles: ["reporter", "idea"] },
  { key: "small", label: "Verdicts, votes, sign-up", roles: ["vote", "comment", "signup"] },
] as const satisfies readonly { key: string; label: string; roles: readonly PointRole[] }[];

/** What a ledger row says happened, for the activity list. */
const DID: Record<PointRole, string> = {
  solver: "solved",
  reporter: "reported",
  reviewer: "review accepted on",
  triager: "confirmed",
  submission: "research answer accepted on",
  dispatcher: "dispatched",
  idea: "verdict on",
  signup: "",
  plan: "plan approved on",
  comment: "comment upvoted on",
  vote: "vote on",
};

export type EarningsSource = { key: string; label: string; amount: number };
export type EarningsTask = { id: string; title: string; reward: number; where: string; href: string };
export type EarningsActivity = { id: string; who: string; did: string; ref: string | null; amount: number; at: Date };

/**
 * The Earnings page: the total and what is being checked, where the money came from, the open issues that pay the
 * most in the projects the person is in (the fastest way to the goal), and the latest payments.
 */
/**
 * Which tasks "Fastest way to your goal" lists (#earnings): the workspace or project selected in the switcher. In a
 * workspace you belong to, every project in it; in one you only joined a project of (from Discover), just the
 * projects you joined there.
 */
export type TaskScope = { organisationId: string; name: string; projectIds: string[] | null };

/**
 * The scope for the switcher's selection, given as `<org>` or `<org>/<project>` (the header's current project), or
 * the person's active workspace when nothing is selected. Null when they can't work anywhere in it.
 */
export async function taskScopeFor(db: Db, userId: string, selected: string | null, activeOrganisationId: string | null): Promise<TaskScope | null> {
  const slug = selected ? decodeURIComponent(selected.split("/")[0] ?? "") : "";
  const organisation = slug
    ? await db.organisation.findUnique({ where: { slug }, select: { id: true, name: true } })
    : activeOrganisationId
      ? await db.organisation.findUnique({ where: { id: activeOrganisationId }, select: { id: true, name: true } })
      : null;
  if (!organisation) return null;
  const [member, joined] = await Promise.all([
    db.membership.findUnique({ where: { organisationId_userId: { organisationId: organisation.id, userId } }, select: { id: true } }),
    db.projectMembership.findMany({ where: { userId, project: { organisationId: organisation.id, archivedAt: null } }, select: { projectId: true } }),
  ]);
  if (member) return { organisationId: organisation.id, name: organisation.name, projectIds: null };
  if (joined.length) return { organisationId: organisation.id, name: organisation.name, projectIds: joined.map((row) => row.projectId) };
  return null;
}

export async function earningsSummary(db: Db, userId: string, scope: TaskScope | null = null) {
  // Everything on the page is for the selected workspace only (Chloe's call: no total across workspaces).
  const inOrg = scope?.organisationId ?? null;
  const here = inOrg ? { organisationId: inOrg } : {};
  const weekStart = startOfWeek();
  const [total, checking, week, goalRow, byRole, solvedCount, latest, projectMemberships] = await Promise.all([
    totalEarned(db, userId, inOrg),
    beingChecked(db, userId, inOrg),
    db.pointEntry.aggregate({ where: { userId, ...here, createdAt: { gte: weekStart } }, _sum: { points: true } }),
    db.user.findUnique({ where: { id: userId }, select: { weeklyEarningsGoal: true } }),
    db.pointEntry.groupBy({ by: ["role"], where: { userId, ...here }, _sum: { points: true } }),
    db.pointEntry.count({ where: { userId, ...here, role: "solver", points: { gt: 0 } } }),
    db.pointEntry.findMany({
      where: { userId, ...here },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 6,
      select: {
        id: true,
        points: true,
        role: true,
        createdAt: true,
        agent: { select: { name: true } },
        bug: { select: { number: true } },
        idea: { select: { number: true } },
      },
    }),
    db.projectMembership.findMany({ where: { userId }, select: { projectId: true } }),
  ]);

  const amountOf = new Map(byRole.map((row) => [row.role, pointsNumber(row._sum.points)]));
  const sources: EarningsSource[] = SOURCE_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    amount: group.roles.reduce((sum, role) => sum + (amountOf.get(role) ?? 0), 0),
  })).filter((source) => source.amount > 0.004);

  // The tasks that pay the most in the selected workspace or project; with nothing to work on there, the
  // best-paying tasks in projects open to join, so there is always somewhere to start.
  const projectIds = projectMemberships.map((row) => row.projectId);
  const open = await db.bug.findMany({
        where: {
          status: "open",
          substatus: "open",
          isDeleted: false,
          ...(scope
            ? { organisationId: scope.organisationId, ...(scope.projectIds ? { projectId: { in: scope.projectIds } } : {}) }
            : { project: { visibility: "public", isOpenForContributors: true, archivedAt: null } }),
        },
        orderBy: [{ reward: "desc" }, { createdAt: "desc" }],
        take: 4,
        select: { id: true, number: true, title: true, reward: true, _count: { select: { bids: true } }, project: { select: { name: true, slug: true, organisation: { select: { slug: true } } } } },
      });

  return {
    joinedProjects: projectIds.length,
    total,
    checking,
    earnedThisWeek: pointsNumber(week._sum.points),
    weeklyGoal: goalRow?.weeklyEarningsGoal == null ? DEFAULT_WEEKLY_GOAL : pointsNumber(goalRow.weeklyEarningsGoal),
    solvedCount,
    sources,
    tasks: open.map((bug): EarningsTask => ({
      id: bug.id,
      title: bug.title,
      reward: pointsNumber(bug.reward),
      where: `#${bug.number} · ${bug._count.bids === 1 ? "1 bid" : `${bug._count.bids} bids`} · ${bug.project.name}`,
      href: issueHref(bug),
    })),
    activity: latest.map((entry): EarningsActivity => {
      const amount = pointsNumber(entry.points);
      const number = entry.bug?.number ?? entry.idea?.number ?? null;
      return {
        id: entry.id,
        who: amount < 0 ? "Correction" : entry.role === "signup" ? "Welcome bonus" : entry.agent?.name ?? "You",
        did: amount < 0 ? "taken back on" : entry.role === "signup" ? "" : DID[entry.role] ?? "earned on",
        ref: number === null ? null : `#${number}`,
        amount,
        at: entry.createdAt,
      };
    }),
  };
}
