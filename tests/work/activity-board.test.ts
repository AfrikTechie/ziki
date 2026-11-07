import { describe, expect, it } from "vitest";
import {
  activityActionText,
  activityIssueNumber,
  buildActivityBoard,
  formatAgo,
  formatCountdown,
  groupEventsByDay,
  nudgeMessage,
  releaseReasonText,
  type ActivityClaim,
  type ActivityData,
  type ActivityIssue,
} from "@/lib/activity/board";

/** The Activity page as a status board (#849): what needs you, what's in progress, what's delivered, what ended. */

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();

const zeddi = { id: "agent-zeddi", name: "Zeddi" };
const zoint = { id: "agent-zoint", name: "Zoint" };

function issue(number: number, overrides: Partial<ActivityIssue> = {}): ActivityIssue {
  return {
    id: `bug-${number}`,
    number,
    title: `Issue ${number}`,
    status: "in_progress",
    substatus: "in_progress",
    pullRequestUrl: null,
    href: `/zedu/desktop/${number}`,
    ...overrides,
  };
}

function claim(id: string, overrides: Partial<ActivityClaim> = {}): ActivityClaim {
  return {
    id,
    status: "active",
    agent: zeddi,
    issue: issue(1),
    offeredAt: at(-60),
    claimedAt: at(-59),
    deliverBy: at(180),
    lastHeartbeatAt: at(-5),
    waitingOnOwnerSince: null,
    releasedAt: null,
    releaseReason: null,
    createdAt: at(-60),
    offerWindowSeconds: 1800,
    deliveryMinutes: 240,
    ...overrides,
  };
}

function data(overrides: Partial<ActivityData> = {}): ActivityData {
  return { agents: [zeddi, zoint], claims: [], questions: [], events: [], slots: [], ...overrides };
}

describe("formatting", () => {
  it("counts down in minutes and seconds under an hour, hours and minutes above", () => {
    expect(formatCountdown(12 * 60_000 + 41_000)).toBe("12:41");
    expect(formatCountdown(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });

  it("says how long ago in the largest unit", () => {
    expect(formatAgo(20_000)).toBe("just now");
    expect(formatAgo(5 * 60_000)).toBe("5m ago");
    expect(formatAgo(2 * 3_600_000)).toBe("2h ago");
    expect(formatAgo(3 * 86_400_000)).toBe("3d ago");
  });

  it("explains release reasons in plain words and spells out unknown ones", () => {
    expect(releaseReasonText("expired")).toBe("the offer wasn't accepted in time");
    expect(releaseReasonText("judged_not_good")).toBe("testers judged it not good to merge");
    expect(releaseReasonText("some_new_reason")).toBe("some new reason");
    expect(releaseReasonText(null)).toBe("the claim ended");
  });

  it("turns audit actions into phrases", () => {
    expect(activityActionText("issue.delivered")).toBe("delivered");
    expect(activityActionText("agent.skills_changed")).toBe("skills changed");
  });

  it("reads the issue filter, matching nothing for anything that isn't a number", () => {
    expect(activityIssueNumber("#2306")).toBe(2306);
    expect(activityIssueNumber(" 42 ")).toBe(42);
    expect(activityIssueNumber("")).toBeUndefined();
    expect(activityIssueNumber("abc")).toBeNull();
  });
});

describe("buildActivityBoard", () => {
  it("puts a live offer under Needs you with the time left to accept and a nudge", () => {
    const board = buildActivityBoard(
      data({ claims: [claim("c1", { status: "offered", offeredAt: at(-17), claimedAt: null, deliverBy: null })] }),
      NOW,
    );
    expect(board.needs).toHaveLength(1);
    expect(board.needs[0]).toMatchObject({ kind: "offer", label: "Offer waiting", timer: "13:00", nudgeClaimId: "c1", urgent: true });
    expect(board.nextDeadline).toBe("13:00");
    expect(board.inProgress).toHaveLength(0);
  });

  it("stops offering a nudge once the offer has run out", () => {
    const board = buildActivityBoard(data({ claims: [claim("c1", { status: "offered", offeredAt: at(-45), claimedAt: null })] }), NOW);
    expect(board.needs[0]).toMatchObject({ timer: "0:00", nudgeClaimId: null });
  });

  it("shows active work with its delivery deadline, and only flags it when the deadline is close", () => {
    const relaxed = buildActivityBoard(data({ claims: [claim("c1", { deliverBy: at(150) })] }), NOW);
    expect(relaxed.inProgress[0]).toMatchObject({ claimId: "c1", timeLeft: "2h 30m", soon: false });
    expect(relaxed.needs).toHaveLength(0);

    const close = buildActivityBoard(data({ claims: [claim("c1", { deliverBy: at(20) })] }), NOW);
    expect(close.inProgress[0].soon).toBe(true);
    expect(close.needs[0]).toMatchObject({ kind: "deadline", timer: "20:00", nudgeClaimId: "c1" });
  });

  it("treats a claim waiting on the owner as paused, not late", () => {
    const board = buildActivityBoard(data({ claims: [claim("c1", { deliverBy: at(5), waitingOnOwnerSince: at(-30) })] }), NOW);
    expect(board.inProgress[0]).toMatchObject({ paused: true, soon: false });
    expect(board.needs).toHaveLength(0);
  });

  it("lists delivered work once per issue with every claim on it as history", () => {
    const delivered = issue(2309, { status: "done", substatus: "accepted", pullRequestUrl: "https://github.com/o/r/pull/1" });
    const board = buildActivityBoard(
      data({
        claims: [
          claim("c2", { issue: delivered, offeredAt: at(-600), claimedAt: at(-590) }),
          claim("c1", { issue: delivered, status: "released", offeredAt: at(-2000), claimedAt: null, releasedAt: at(-1970), releaseReason: "expired" }),
        ],
      }),
      NOW,
    );
    expect(board.delivered).toHaveLength(1);
    expect(board.delivered[0]).toMatchObject({ stage: "Done · Accepted", stageTone: "ok" });
    expect(board.delivered[0].history.map((entry) => entry.what)).toEqual(["Offered", "Expired", "Offered", "Accepted"]);
    expect(board.ended).toHaveLength(1);
    expect(board.ended[0]).toMatchObject({ label: "Expired", reason: "the offer wasn't accepted in time" });
  });

  it("asks the owner to review a plan held for approval", () => {
    const board = buildActivityBoard(data({ claims: [claim("c1", { status: "planning", claimedAt: at(-41), deliverBy: null })] }), NOW);
    expect(board.needs[0]).toMatchObject({ kind: "plan", label: "Plan to review", timer: "41m", nudgeClaimId: null });
    expect(board.inProgress).toHaveLength(0);
    expect(board.agents.find((summary) => summary.agent.id === zeddi.id)).toMatchObject({ status: "Plan to review" });
  });

  it("brings work sent back by testers into Needs you while the issue is open again", () => {
    const reopened = issue(2314, { status: "open", substatus: "open" });
    const board = buildActivityBoard(
      data({ claims: [claim("c1", { issue: reopened, status: "released", releasedAt: at(-120), releaseReason: "judged_not_good" })] }),
      NOW,
    );
    expect(board.needs[0]).toMatchObject({ kind: "sent_back", label: "Sent back", timer: "2h ago", nudgeClaimId: null });
    expect(board.ended[0].reason).toBe("testers judged it not good to merge");
  });

  it("sorts what runs out first to the top, with questions after the clocks", () => {
    const board = buildActivityBoard(
      data({
        claims: [
          claim("due", { deliverBy: at(25) }),
          claim("offer", { agent: zoint, issue: issue(2), status: "offered", offeredAt: at(-25), claimedAt: null }),
        ],
        questions: [{ id: "q1", agent: zoint, issue: null, body: "Keep or release?", createdAt: at(-41), href: "/inbox/escalations/q1" }],
      }),
      NOW,
    );
    expect(board.needs.map((need) => need.kind)).toEqual(["offer", "deadline", "question"]);
    expect(board.needs[2]).toMatchObject({ timer: "41m", href: "/inbox/escalations/q1" });
  });

  it("narrows every section and the agents panel to one agent", () => {
    const all = data({
      claims: [claim("c1"), claim("c2", { agent: zoint, issue: issue(2), status: "offered", claimedAt: null, offeredAt: at(-1) })],
    });
    const board = buildActivityBoard(all, NOW, zoint.id);
    expect(board.inProgress).toHaveLength(0);
    expect(board.needs.map((need) => need.agent.id)).toEqual([zoint.id]);
    expect(board.agents.map((summary) => summary.agent.id)).toEqual([zoint.id]);
  });

  it("sums up each agent's state", () => {
    const board = buildActivityBoard(
      data({ claims: [claim("c1"), claim("c2", { agent: zoint, issue: issue(2), status: "offered", claimedAt: null, offeredAt: at(-1) })] }),
      NOW,
    );
    expect(board.agents.find((summary) => summary.agent.id === zeddi.id)).toMatchObject({ status: "Working", tone: "info" });
    expect(board.agents.find((summary) => summary.agent.id === zoint.id)).toMatchObject({ status: "Offer waiting", tone: "warn" });
  });
});

describe("nudgeMessage", () => {
  it("asks an agent to accept an offer before it expires", () => {
    const text = nudgeMessage(
      { status: "offered", issueNumber: 2306, issueTitle: "Search results", offerExpiresAt: new Date("2026-11-06T12:30:00Z"), deliverBy: null },
      "Jennifer",
    );
    expect(text).toBe('Nudge from Jennifer: you\'ve been offered #2306 "Search results". Please accept or decline it before the offer expires at 2026-11-06T12:30:00.000Z.');
  });

  it("asks an agent with a claim to deliver by its deadline", () => {
    const text = nudgeMessage(
      { status: "active", issueNumber: 2333, issueTitle: "Compose", offerExpiresAt: null, deliverBy: new Date("2026-11-06T16:14:00Z") },
      "Jennifer",
    );
    expect(text).toContain("It's due by 2026-11-06T16:14:00.000Z.");
    expect(text).toContain("ask for an extension");
  });

  it("asks an agent to send a planning proposal for approval", () => {
    const text = nudgeMessage(
      { status: "planning", issueNumber: 2340, issueTitle: "Plan review", offerExpiresAt: null, deliverBy: null },
      "Jennifer",
    );
    expect(text).toBe('Nudge from Jennifer: please send your plan for #2340 "Plan review" so it can be approved.');
  });
});

describe("groupEventsByDay", () => {
  it("groups the feed under Today, Yesterday and earlier dates, newest first", () => {
    const now = new Date(2026, 10, 6, 15, 0).getTime();
    const event = (id: string, date: Date) => ({ id, agent: zeddi, action: "issue.delivered", createdAt: date.toISOString(), undone: false, issue: null });
    const groups = groupEventsByDay(
      [event("a", new Date(2026, 10, 6, 14)), event("b", new Date(2026, 10, 5, 22)), event("c", new Date(2026, 10, 3, 9))],
      now,
    );
    expect(groups.map((group) => group.day.length > 0)).toEqual([true, true, true]);
    expect(groups[0]).toMatchObject({ day: "Today" });
    expect(groups[1]).toMatchObject({ day: "Yesterday" });
    expect(groups[2].events.map((item) => item.id)).toEqual(["c"]);
  });
});
