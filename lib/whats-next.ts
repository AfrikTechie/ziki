import type { Substatus } from "@prisma/client";

/**
 * What's next on an issue in Your Work (#your-work): which kind of your work it
 * is (the tag), the step it waits on, and whether that step is yours (or your
 * agent's) to take.
 */
export type WorkTag = "Your bid" | "Offered to you" | "Assigned to you" | "Overdue" | "In review" | "Accepted" | "Merging" | "Can't merge";
export type WhatsNext = { tag: WorkTag; text: string; yours: boolean; late?: boolean };

/** Each tag's colours: blue while it's yours to do, grey while others act, red when it's late or stuck. */
export const WORK_TAG_TONE: Record<WorkTag, string> = {
  "Your bid": "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "Offered to you": "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "Assigned to you": "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  Overdue: "bg-zk-bad-bg text-zk-bad-fg",
  "In review": "bg-zk-chip text-zk-text2",
  Accepted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  Merging: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "Can't merge": "bg-zk-bad-bg text-zk-bad-fg",
};

/** Your claims on the issue (already only yours). */
type Claim = { status: string; deliverBy?: Date | null };

const HOUR = 60 * 60 * 1000;

function deliverWithin(deliverBy: Date, now: number): string {
  const hours = Math.round((deliverBy.getTime() - now) / HOUR);
  return hours < 1 ? "Deliver the work within the hour" : hours < 48 ? `Deliver the work within ${hours}h` : `Deliver the work within ${Math.round(hours / 24)} days`;
}

export function whatsNext(substatus: Substatus, myClaims: Claim[], myBid: boolean, now = Date.now()): WhatsNext {
  const active = myClaims.find((c) => c.status === "active");
  const offered = myClaims.find((c) => c.status === "offered");
  if (offered && !active) return { tag: "Offered to you", text: "Accept the offer to start", yours: true };
  switch (substatus) {
    case "requires_confirmation":
    case "open":
      if (active) return { tag: "Assigned to you", text: "Start the work", yours: true };
      return myBid
        ? { tag: "Your bid", text: substatus === "open" ? "Waiting for the award" : "Waiting for confirmation, then the award", yours: false }
        : { tag: "Assigned to you", text: "Start the work", yours: true };
    case "in_progress":
      if (active?.deliverBy && active.deliverBy.getTime() < now) return { tag: "Overdue", text: "Deliver the work: past the deadline", yours: true, late: true };
      return { tag: "Assigned to you", text: active?.deliverBy ? deliverWithin(active.deliverBy, now) : "Deliver the work", yours: true };
    case "requires_review":
      return { tag: "In review", text: "Testers are judging your delivery", yours: false };
    case "accepted":
      return { tag: "Accepted", text: "A manager reviews it next", yours: false };
    case "ready_to_merge":
      return { tag: "Merging", text: "Waiting to be merged", yours: false };
    case "error":
      return { tag: "Can't merge", text: "Fix the pull request so it can merge", yours: true, late: true };
    default:
      return { tag: "Merging", text: "On its way live", yours: false };
  }
}
