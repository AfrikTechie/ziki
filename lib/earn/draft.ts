/**
 * Earn (#earn-drafts): people who come to Ziki only to earn get tasks that
 * market Ziki (mostly cold email), and are paid for them. Withdrawing opens
 * at WITHDRAW_THRESHOLD, which the starter tasks alone don't reach: the rest
 * comes when someone they reached starts using Ziki.
 *
 * Where someone is comes from the database (lib/earn/progress.ts and
 * lib/earn/state.ts): their task rows and the points ledger. The amounts are
 * placeholders for Mark to set. The sample people below and the preview
 * stages only feed the People page and local demos; the preview cookie is
 * ignored in production.
 */

export const WITHDRAW_THRESHOLD = 30;
/** Paid from open-source tasks; it is what takes you past the threshold. */
export const CONVERSION_BONUS = 11;
/** Where earners CC their cold emails, so Ziki can count them. */
export const EARN_CC_ADDRESS = "earn@ziki.dev";

export type EarnTaskId = "who" | "research" | "emails" | "post";
/** `target`: how many make the task (10 people, 10 emails), or 1 for a task done once. */
export type EarnTask = { id: EarnTaskId; title: string; detail: string; pay: number; target: number; done: boolean };

export const EARN_TASKS: EarnTask[] = [
  { id: "who", title: "Tell us who needs Ziki", detail: "One sentence about a kind of business. Takes 2 minutes.", pay: 3, target: 1, done: false },
  { id: "research", title: "Research 10 people with your agent", detail: "Your agent finds businesses that match what you wrote.", pay: 2, target: 10, done: false },
  { id: "emails", title: "Send 10 emails", detail: "From your own email, with your link. CC Ziki so each one counts.", pay: 4, target: 10, done: false },
  { id: "post", title: "Post about Ziki", detail: "Share your link on X, LinkedIn or your WhatsApp status.", pay: 5, target: 1, done: false },
];

/** Who does what on each task, and what to send back as proof. The agent does the work; the person checks it and sends it from their own accounts. */
export const EARN_WORK: Record<EarnTaskId, { agent: string; you: string; proofLabel: string; proofHint: string }> = {
  who: {
    agent: "Suggests the kinds of business that could use Ziki.",
    you: "Pick one and write a sentence about it: a place, a kind of business, a problem they have.",
    proofLabel: "Who needs Ziki",
    proofHint: "Bakeries in Lagos that take orders on Instagram but have no website",
  },
  research: {
    agent: "Finds 10 businesses that match what you wrote.",
    you: "Look the list over, then paste it: a name and a way to reach each one.",
    proofLabel: "The 10 businesses",
    proofHint: "One per line: name, where, email or website",
  },
  emails: {
    agent: "Writes 10 emails, each with your link.",
    you: `Send them from your own email, copying ${EARN_CC_ADDRESS} so each one counts. Then say who you sent to.`,
    proofLabel: "Who you emailed",
    proofHint: "The 10 addresses you sent to",
  },
  post: {
    agent: "Writes a post with your link.",
    you: "Share it on X, LinkedIn or your WhatsApp status, then paste the link to it.",
    proofLabel: "Link to your post",
    proofHint: "https://x.com/you/status/…",
  },
};

export type Reached = { name: string; contact: string; emailed: string | null; opened: string | null; signedUp: string | null; started: string | null };

export const EARN_PEOPLE: Reached[] = [
  { name: "Mama Ade's Bakery", contact: "hello@mamaade.ng", emailed: "2 Nov", opened: "2 Nov", signedUp: "3 Nov", started: null },
  { name: "Crust & Co", contact: "crustandco@gmail.com", emailed: "2 Nov", opened: "3 Nov", signedUp: null, started: null },
  { name: "Bread Basket Ikeja", contact: "orders@breadbasket.ng", emailed: "3 Nov", opened: null, signedUp: null, started: null },
  { name: "Funmi's Cakes", contact: "funmicakes@yahoo.com", emailed: "3 Nov", opened: null, signedUp: null, started: null },
  { name: "Golden Crust Ikorodu", contact: "goldencrust.ikd@gmail.com", emailed: "3 Nov", opened: "4 Nov", signedUp: null, started: null },
  { name: "Sweet Bites Ajah", contact: "hello@sweetbites.ng", emailed: "3 Nov", opened: "4 Nov", signedUp: null, started: null },
  { name: "Oven Fresh Yaba", contact: "ovenfreshyaba@gmail.com", emailed: "3 Nov", opened: null, signedUp: null, started: null },
  { name: "The Cake Room", contact: "orders@thecakeroom.ng", emailed: "4 Nov", opened: null, signedUp: null, started: null },
  { name: "Lekki Loaves", contact: "lekkiloaves@gmail.com", emailed: "4 Nov", opened: null, signedUp: null, started: null },
  { name: "Bake House Surulere", contact: "bakehouse.sur@yahoo.com", emailed: "4 Nov", opened: null, signedUp: null, started: null },
];

/** People who opened the earner's link from their post, not from an email. */
export const EARN_POST_OPENS = 2;

/** The workspace earners work in (#earn-drafts): new and empty, like any new user's. Locally "Ziki Earn" (scripts/dev/earn-sample-workspace.ts). */
export const EARN_WORKSPACE_SLUG = "ziki-earn";

/** The sample earner's personal link, which counts who comes through it. */
export const EARN_LINK = "ziki.dev/r/chloe";

/**
 * The welcome for coming to earn: paid once, to anyone who opens an earn page
 * for the first time, new account or old (grantWelcome in lib/earn/progress.ts).
 * Not the site's own sign-up bonus (lib/points/signup-bonus.ts).
 */
export const SIGNUP_BONUS = 5;

/**
 * An account made on or after this moment signed up after Earn went live: it is shown the "$5 awarded" pop-up
 * when it first opens Earn. An older account still gets the $5 in its balance, quietly. A placeholder for Mark.
 */
export const EARN_WELCOME_FROM = new Date("2026-11-05T00:00:00.000Z");

/** Set once the person has dismissed the "$5 awarded" pop-up, so it shows once per browser. */
export const EARN_WELCOME_SEEN_COOKIE = "earn-welcome-seen";

/** The earner's project in that workspace: its main list holds the Ziki tasks step. */
export const EARN_PROJECT_SLUG = "ziki-earn";

/**
 * Draft only: where the sample earner is. "new" has just signed up and
 * connected their agent ($5, the default); "task1"…"task3" have had that many
 * tasks paid; "progress" has had all four paid ($19); "unlocked" has had
 * someone they reached start a project ($30). /earn/preview?state=… sets it
 * in a cookie so every page agrees.
 */
export type EarnStage = "new" | "task1" | "task2" | "task3" | "progress" | "unlocked";
export const EARN_STAGES: EarnStage[] = ["new", "task1", "task2", "task3", "progress", "unlocked"];
export const EARN_PREVIEW_COOKIE = "earn-preview";

/** Whether the demo stage switcher and the preview cookie work: never in production. */
export function earnPreviewEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

const PAID_AT: Record<EarnStage, number> = { new: 0, task1: 1, task2: 2, task3: 3, progress: 4, unlocked: 4 };

/** How many of the four tasks are paid at a stage. */
export function tasksPaid(stage: EarnStage): number {
  return PAID_AT[stage];
}

/** The stage once this many tasks are paid, in order. */
export function stageForPaid(paid: number): EarnStage {
  if (paid <= 0) return "new";
  return paid >= EARN_TASKS.length ? "progress" : (`task${paid}` as EarnStage);
}

/** A Ziki task's own page, under Marketing: /earn/marketing/<n>. Not an issue page. */
export function zikiTaskPath(n: number): string {
  return `/earn/marketing/${n}`;
}

/** Where earners do their Ziki tasks: their own page, not the builders' issue list. */
export const ZIKI_TASKS_PATH = "/earn/marketing";

/** Everything the Withdraw window needs: never locked, it shows the threshold and how to reach it. */
export type WithdrawInfo = {
  earned: number;
  threshold: number;
  ready: boolean;
  fromTasks: number;
  fromPerson: number;
  ways: { label: string; pay: number; done: boolean; next: boolean; href: string | null }[];
  next: { n: number; title: string; pay: number; href: string } | null;
};

/** `earned` is what the ledger says; without it the stage's own sum is used (demos). */
export function withdrawInfo(stage: EarnStage, earned?: number, done?: readonly EarnTaskId[]): WithdrawInfo {
  const balance = earnBalance(stage, earned, done);
  const tasks = stageTasks(stage, done);
  const nextIndex = tasks.findIndex((task) => !task.done);
  const left = Math.max(0, WITHDRAW_THRESHOLD - balance.earned);
  const fromTasks = Math.min(balance.tasksLeft, left);
  return {
    earned: balance.earned,
    threshold: WITHDRAW_THRESHOLD,
    ready: balance.withdrawable > 0,
    fromTasks,
    fromPerson: balance.converted ? 0 : CONVERSION_BONUS,
    ways: [
      ...(SIGNUP_BONUS > 0 ? [{ label: "You signed up", pay: SIGNUP_BONUS, done: true, next: false, href: null }] : []),
      ...tasks.map((task, i) => ({ label: task.title, pay: task.pay, done: task.done, next: i === nextIndex, href: task.done ? null : zikiTaskPath(i + 1) })),
      { label: "Fix open-source issues", pay: CONVERSION_BONUS, done: balance.converted, next: nextIndex < 0 && !balance.converted, href: nextIndex < 0 ? "/earn/people" : null },
    ],
    next: nextIndex < 0 ? null : { n: nextIndex + 1, title: tasks[nextIndex].title, pay: tasks[nextIndex].pay, href: zikiTaskPath(nextIndex + 1) },
  };
}

/** True once all four tasks are paid. */
export function tasksDone(stage: EarnStage): boolean {
  return tasksPaid(stage) === EARN_TASKS.length;
}

/** The four tasks as they stand at a stage: the first N paid, in order. */
export function stageTasks(stage: EarnStage, done?: readonly EarnTaskId[]): EarnTask[] {
  // All four tasks are open at once, so which are paid comes from the person's own confirmed tasks when known;
  // without that (the demo stages) the first N are taken as paid.
  if (done) return EARN_TASKS.map((task) => ({ ...task, done: done.includes(task.id) }));
  const paid = tasksPaid(stage);
  return EARN_TASKS.map((task, i) => ({ ...task, done: i < paid }));
}

/** The people reached at a stage: nobody yet when new; the closest one has started once unlocked. */
export function stagePeople(stage: EarnStage): Reached[] {
  // Nobody is tracked yet: the sample people below exist only for demos, never for a real earner.
  if (!earnPreviewEnabled() || !tasksDone(stage)) return [];
  return EARN_PEOPLE.map((person, i) => (stage === "unlocked" && i === 0 ? { ...person, started: "4 Nov" } : person));
}

/** What the sample earner's agent is doing now, shown on its card on My agents. */
export function earnAgentActivity(stage: EarnStage): string {
  if (!tasksDone(stage)) return tasksPaid(stage) === 0 ? "Ready for your first task" : `Ready for task ${tasksPaid(stage) + 1} of ${EARN_TASKS.length}`;
  return stage === "unlocked" ? "Looking for project work to bid on" : "Following up on your 10 emails";
}

export type EarnBalance = {
  stage: EarnStage;
  earned: number;
  withdrawable: number;
  /** Still to come from tasks not done yet. */
  tasksLeft: number;
  converted: boolean;
  heldReason: string | null;
  /** The tasks that are paid, in any order. Pass it on to stageTasks and withdrawInfo so every page agrees on which. */
  done: EarnTaskId[];
};

/**
 * What an earner has at a stage: earned from finished tasks, nothing
 * withdrawable until the threshold. `earnedOverride` is the ledger's figure for
 * a real earner; without it the stage's own sum is used (demos).
 */
export function earnBalance(stage: EarnStage = "new", earnedOverride?: number, doneOverride?: readonly EarnTaskId[]): EarnBalance {
  const tasks = stageTasks(stage, doneOverride);
  const earned = SIGNUP_BONUS + tasks.filter((task) => task.done).reduce((sum, task) => sum + task.pay, 0);
  const converted = stage === "unlocked";
  const total = earnedOverride ?? earned + (converted ? CONVERSION_BONUS : 0);
  const tasksLeft = tasks.filter((task) => !task.done).reduce((sum, task) => sum + task.pay, 0);
  // Say exactly what's left: the tasks still open and, until it happens, one person starting.
  const needs = [
    tasksLeft > 0 ? `finish your tasks (+$${tasksLeft})` : null,
    converted ? null : `do open-source tasks (+$${CONVERSION_BONUS})`,
  ].filter(Boolean);
  return {
    stage,
    earned: total,
    withdrawable: total >= WITHDRAW_THRESHOLD ? total : 0,
    tasksLeft,
    converted,
    heldReason: total >= WITHDRAW_THRESHOLD ? null : `To reach $${WITHDRAW_THRESHOLD}, ${needs.join(" and ")}. What you've earned stays yours.`,
    done: tasks.filter((task) => task.done).map((task) => task.id),
  };
}
