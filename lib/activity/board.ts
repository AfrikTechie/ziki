import type { Status, Substatus } from "@prisma/client";
import { stateLabel } from "@/lib/labels";

/**
 * The Activity page as a status board (#849). Pure: the page loads claims,
 * questions and audit events (lib/activity/queries.ts), and this turns them
 * into sections for a given moment, so the countdowns can move every second
 * on the client without asking the server again. Dates arrive as ISO strings
 * because the data crosses from the server page to a client component.
 */

export type ActivityIssue = {
  id: string;
  number: number;
  title: string;
  status: Status;
  substatus: Substatus;
  pullRequestUrl: string | null;
  href: string;
};

export type ActivityAgent = { id: string; name: string };

export type ActivityClaim = {
  id: string;
  status: "offered" | "active" | "released";
  agent: ActivityAgent;
  issue: ActivityIssue;
  offeredAt: string | null;
  claimedAt: string | null;
  deliverBy: string | null;
  lastHeartbeatAt: string | null;
  waitingOnOwnerSince: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  createdAt: string;
  /** The issue's project settings: how long an offer stays open, and the delivery window. */
  offerWindowSeconds: number;
  deliveryMinutes: number;
};

export type ActivityQuestion = {
  id: string;
  agent: ActivityAgent;
  issue: ActivityIssue | null;
  body: string;
  createdAt: string;
  href: string;
};

export type ActivityEvent = {
  id: string;
  agent: ActivityAgent;
  action: string;
  createdAt: string;
  undone: boolean;
  issue: ActivityIssue | null;
};

export type ActivitySlots = { project: string; used: number; max: number };

export type ActivityData = {
  agents: ActivityAgent[];
  claims: ActivityClaim[];
  questions: ActivityQuestion[];
  events: ActivityEvent[];
  slots: ActivitySlots[];
};

export type Tone = "warn" | "info" | "ok" | "neutral";

export type NeedItem = {
  key: string;
  kind: "offer" | "deadline" | "sent_back" | "question";
  label: string;
  agent: ActivityAgent;
  issue: ActivityIssue | null;
  why: string;
  /** The big number on the left: a countdown, or how long it has waited. */
  timer: string;
  timerLabel: string;
  /** 0–1 of the window left, for the bar; null when there is no clock. */
  progress: number | null;
  urgent: boolean;
  /** The claim a nudge is about; questions are answered in the Inbox instead. */
  nudgeClaimId: string | null;
  href: string | null;
  sortKey: number;
};

export type ProgressItem = {
  claimId: string;
  agent: ActivityAgent;
  issue: ActivityIssue;
  acceptedAgo: string;
  deliverBy: string | null;
  timeLeft: string | null;
  progress: number | null;
  soon: boolean;
  paused: boolean;
  lastUpdate: string;
};

export type HistoryEntry = { key: string; what: string; detail: string; at: string; tone: Tone };

export type DeliveredItem = {
  issue: ActivityIssue;
  agent: ActivityAgent;
  stage: string;
  stageTone: Tone;
  history: HistoryEntry[];
};

export type EndedItem = {
  claimId: string;
  label: "Released" | "Expired";
  agent: ActivityAgent;
  issue: ActivityIssue;
  reason: string;
  at: string;
};

export type AgentSummary = { agent: ActivityAgent; status: string; tone: Tone; detail: string };

export type ActivityBoard = {
  needs: NeedItem[];
  inProgress: ProgressItem[];
  delivered: DeliveredItem[];
  ended: EndedItem[];
  agents: AgentSummary[];
  nextDeadline: string | null;
};

/** A claim this close to its delivery deadline also shows under "Needs you". */
export const DEADLINE_SOON_MS = 30 * 60 * 1000;
/** Work sent back stays under "Needs you" this long, so it can be re-bid. */
export const SENT_BACK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Each section shows this many rows before "Show more". */
export const ACTIVITY_SECTION_PAGE = 20;

/** "#123" or "123" narrows every section to that issue; anything else matches nothing. */
export function activityIssueNumber(value: string | string[] | undefined): number | null | undefined {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().replace(/^#/, "");
  if (!raw) return undefined;
  const number = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(number) && number <= 2147483647 ? number : null;
}

const SENT_BACK_REASONS = new Set(["judged_not_good", "manager_rejected"]);
const DELIVERED_STATUSES = new Set<Status>(["done", "merge"]);

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

/** "3h 12m" from an hour up, "12:41" below it, never negative. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "just now", "5m ago", "2h ago", "3d ago". */
export function formatAgo(elapsedMs: number): string {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const REASONS: Record<string, string> = {
  expired: "the offer wasn't accepted in time",
  offer_expired: "the offer wasn't accepted in time",
  deadline: "the delivery deadline passed",
  silence: "the agent stopped checking in",
  judged_not_good: "testers judged it not good to merge",
  manager_rejected: "a manager rejected the work",
  agent: "the agent let it go",
  undo: "the award was undone",
  resolved: "the issue went live",
  closed: "the issue was closed",
  deleted: "the issue was deleted",
  owner_unresponsive: "the agent's question to you went unanswered",
  revoked: "the agent was revoked",
  paused: "the agent was paused",
  reassigned: "the issue was given to someone else",
  abandoned: "people voted that the work was abandoned",
  capacity: "you were at your claim limit",
  unavailable: "the agent was unavailable",
  accepted: "the work was accepted",
};

/** Why a claim ended, in plain words. Unknown codes are spelled out rather than hidden. */
export function releaseReasonText(reason: string | null): string {
  if (!reason) return "the claim ended";
  return REASONS[reason] ?? reason.replace(/[._]+/g, " ");
}

const ACTIONS: Record<string, string> = {
  "issue.delivered": "delivered",
  "issue.accepted": "accepted the fix on",
  "issue.resolved": "resolved",
  "issue.deployed": "reported a deployment of",
  "issue.confirmation": "confirmed",
  "issue.merge_reviewed": "reviewed",
  "issue.pull_request_reported": "reported the pull request on",
  "issue.closed": "closed",
  "issue.reopened": "reopened",
  "issue.close_suggested": "suggested closing",
  "issue.bid_voted": "voted on a bid for",
  "offer.accepted": "accepted the offer on",
  "claim.released": "let go of",
  "question.asked": "asked you about",
  "message.sent": "received your message",
  "comment.created": "commented on",
  "idea.created": "filed an idea",
  "idea.converted": "turned an idea into",
  "agent.key_rotated": "had its key rotated",
};

/** An audit action as a phrase after the agent's name ("Zeddi delivered #2306"). */
export function activityActionText(action: string): string {
  return ACTIONS[action] ?? action.replace(/^[a-z]+\./, "").replace(/[._]+/g, " ");
}

function stageTone(status: Status, substatus: Substatus): Tone {
  if (substatus === "error") return "warn";
  return status === "merge" || substatus === "accepted" ? "ok" : "info";
}

function offerDeadline(claim: ActivityClaim): number | null {
  const offeredAt = ms(claim.offeredAt) ?? ms(claim.createdAt);
  return offeredAt === null ? null : offeredAt + claim.offerWindowSeconds * 1000;
}

/** Every claim on one issue, oldest first, as history lines. */
function historyFor(claims: ActivityClaim[]): HistoryEntry[] {
  const lines: HistoryEntry[] = [];
  for (const claim of claims) {
    if (claim.offeredAt) {
      lines.push({ key: `${claim.id}:offered`, what: "Offered", detail: `to ${claim.agent.name}`, at: claim.offeredAt, tone: "neutral" });
    }
    if (claim.claimedAt) {
      lines.push({ key: `${claim.id}:accepted`, what: "Accepted", detail: `${claim.agent.name} took the claim`, at: claim.claimedAt, tone: "info" });
    }
    if (claim.releasedAt) {
      const expired = claim.releaseReason === "expired" || claim.releaseReason === "offer_expired";
      lines.push({
        key: `${claim.id}:ended`,
        what: expired ? "Expired" : "Released",
        detail: releaseReasonText(claim.releaseReason),
        at: claim.releasedAt,
        tone: "neutral",
      });
    }
  }
  return lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}

/** The board for `now`, narrowed to one agent when `agentId` is given. */
export function buildActivityBoard(data: ActivityData, now: number, agentId: string | null = null): ActivityBoard {
  const mine = <T extends { agent: ActivityAgent }>(row: T) => !agentId || row.agent.id === agentId;
  const claims = data.claims.filter(mine);
  const needs: NeedItem[] = [];
  const inProgress: ProgressItem[] = [];
  const delivered = new Map<string, DeliveredItem>();
  const ended: EndedItem[] = [];

  for (const claim of claims) {
    if (claim.releasedAt) {
      const expired = claim.releaseReason === "expired" || claim.releaseReason === "offer_expired";
      ended.push({ claimId: claim.id, label: expired ? "Expired" : "Released", agent: claim.agent, issue: claim.issue, reason: releaseReasonText(claim.releaseReason), at: claim.releasedAt });
      const releasedAt = ms(claim.releasedAt) ?? 0;
      if (claim.releaseReason && SENT_BACK_REASONS.has(claim.releaseReason) && claim.issue.status === "open" && now - releasedAt < SENT_BACK_WINDOW_MS) {
        needs.push({
          key: `sent:${claim.id}`, kind: "sent_back", label: "Sent back", agent: claim.agent, issue: claim.issue,
          why: `${claim.agent.name}'s work was released because ${releaseReasonText(claim.releaseReason)}. The issue is Open again and can be re-bid.`,
          timer: formatAgo(now - releasedAt), timerLabel: "since it was sent back", progress: null, urgent: false,
          nudgeClaimId: null, href: claim.issue.href, sortKey: Number.MAX_SAFE_INTEGER - releasedAt,
        });
      }
      continue;
    }

    if (claim.status === "offered") {
      const deadline = offerDeadline(claim);
      const left = deadline === null ? 0 : deadline - now;
      needs.push({
        key: `offer:${claim.id}`, kind: "offer", label: "Offer waiting", agent: claim.agent, issue: claim.issue,
        why: left > 0
          ? `${claim.agent.name} was awarded this claim. If it isn't accepted in time, the offer expires and the issue goes back to Open.`
          : `The offer to ${claim.agent.name} has run out and will be released.`,
        timer: formatCountdown(left), timerLabel: "to accept the offer",
        progress: Math.max(0, Math.min(1, left / (claim.offerWindowSeconds * 1000))), urgent: true,
        nudgeClaimId: left > 0 ? claim.id : null, href: claim.issue.href, sortKey: left,
      });
      continue;
    }

    if (DELIVERED_STATUSES.has(claim.issue.status)) {
      delivered.set(claim.issue.id, {
        issue: claim.issue, agent: claim.agent,
        stage: stateLabel(claim.issue.substatus), stageTone: stageTone(claim.issue.status, claim.issue.substatus),
        history: [],
      });
      continue;
    }
    if (claim.issue.status !== "in_progress") continue;

    const paused = Boolean(claim.waitingOnOwnerSince);
    const due = ms(claim.deliverBy);
    const left = due === null ? null : due - now;
    const windowMs = claim.deliveryMinutes * 60 * 1000;
    const soon = !paused && left !== null && left < DEADLINE_SOON_MS;
    const seen = ms(claim.lastHeartbeatAt) ?? ms(claim.claimedAt) ?? ms(claim.createdAt) ?? now;
    inProgress.push({
      claimId: claim.id, agent: claim.agent, issue: claim.issue,
      acceptedAgo: formatAgo(now - (ms(claim.claimedAt) ?? ms(claim.createdAt) ?? now)),
      deliverBy: claim.deliverBy,
      timeLeft: left === null ? null : formatCountdown(left),
      progress: left === null ? null : Math.max(0, Math.min(1, left / windowMs)),
      soon, paused,
      lastUpdate: paused ? "Paused: waiting for your answer, so the clock is stopped" : `Last update ${formatAgo(now - seen)}`,
    });
    if (soon && left !== null) {
      needs.push({
        key: `due:${claim.id}`, kind: "deadline", label: "Deadline soon", agent: claim.agent, issue: claim.issue,
        why: `${claim.agent.name} hasn't delivered yet. If the delivery window runs out, the claim is released and the issue goes back to Open.`,
        timer: formatCountdown(left), timerLabel: "left to deliver",
        progress: Math.max(0, Math.min(1, left / windowMs)), urgent: true,
        nudgeClaimId: claim.id, href: claim.issue.href, sortKey: left,
      });
    }
  }

  for (const question of data.questions.filter(mine)) {
    const asked = ms(question.createdAt) ?? now;
    needs.push({
      key: `question:${question.id}`, kind: "question", label: "Question for you", agent: question.agent, issue: question.issue,
      why: question.body, timer: formatAgo(now - asked).replace(" ago", ""), timerLabel: "waiting for your reply",
      progress: null, urgent: false, nudgeClaimId: null, href: question.href,
      sortKey: Number.MAX_SAFE_INTEGER / 2 - asked,
    });
  }

  for (const item of delivered.values()) {
    item.history = historyFor(claims.filter((claim) => claim.issue.id === item.issue.id));
  }

  needs.sort((a, b) => a.sortKey - b.sortKey);
  const dueAt = (item: ProgressItem) => Date.parse(item.deliverBy ?? "") || Number.MAX_SAFE_INTEGER;
  inProgress.sort((a, b) => dueAt(a) - dueAt(b));
  ended.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const agents = data.agents.filter((agent) => !agentId || agent.id === agentId).map((agent): AgentSummary => {
    const offer = needs.find((need) => need.kind === "offer" && need.agent.id === agent.id);
    if (offer) return { agent, status: "Offer waiting", tone: "warn", detail: `#${offer.issue?.number} · accept within ${offer.timer}` };
    const working = inProgress.find((item) => item.agent.id === agent.id);
    if (working) {
      return {
        agent,
        status: working.paused ? "Waiting on you" : working.soon ? "Deadline soon" : "Working",
        tone: working.paused || working.soon ? "warn" : "info",
        detail: `#${working.issue.number}${working.timeLeft ? ` · ${working.timeLeft} left to deliver` : ""}`,
      };
    }
    const waiting = [...delivered.values()].filter((item) => item.agent.id === agent.id).length;
    if (waiting) return { agent, status: "Waiting on review", tone: "ok", detail: `${waiting} delivered ${waiting === 1 ? "issue" : "issues"} in review or merge` };
    return { agent, status: "Idle", tone: "neutral", detail: "No offers or claims right now" };
  });

  const nextUrgent = needs.find((need) => need.urgent);
  return {
    needs,
    inProgress,
    delivered: [...delivered.values()],
    ended,
    agents,
    nextDeadline: nextUrgent ? nextUrgent.timer : null,
  };
}

/** Recent activity, newest first, grouped under a day heading ("Today", "Yesterday", "3 Nov"). */
export function groupEventsByDay(events: ActivityEvent[], now: number, agentId: string | null = null) {
  const startOf = (time: number) => {
    const day = new Date(time);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };
  const today = startOf(now);
  const groups: { day: string; events: ActivityEvent[] }[] = [];
  for (const event of events) {
    if (agentId && event.agent.id !== agentId) continue;
    const start = startOf(Date.parse(event.createdAt));
    const day = start === today
      ? "Today"
      : start === today - 86_400_000
        ? "Yesterday"
        : new Date(start).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const last = groups.at(-1);
    if (last && last.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
}

/**
 * The message a Nudge sends (#849): for an agent that doesn't run all the
 * time, a nudge lands in its inbox as a message from its owner, saying what
 * to do and by when. Times are ISO so the agent can read them exactly.
 */
export function nudgeMessage(
  claim: { status: "offered" | "active"; issueNumber: number; issueTitle: string; offerExpiresAt: Date | null; deliverBy: Date | null },
  from: string,
): string {
  const issue = `#${claim.issueNumber} "${claim.issueTitle}"`;
  if (claim.status === "offered") {
    const until = claim.offerExpiresAt ? ` before the offer expires at ${claim.offerExpiresAt.toISOString()}` : "";
    return `Nudge from ${from}: you've been offered ${issue}. Please accept or decline it${until}.`;
  }
  const due = claim.deliverBy ? ` It's due by ${claim.deliverBy.toISOString()}.` : "";
  return `Nudge from ${from}: please keep going on ${issue} and deliver it.${due} If you need more time, ask for an extension.`;
}
