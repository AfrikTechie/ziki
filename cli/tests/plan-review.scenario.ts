import { beforeAll, describe, expect, it } from "vitest";
import { confirm, fileIssue, ok, refused, type Agent } from "./helpers";

type Item = { kind: string; key: string; canAct: boolean; blockedReason?: string; issue?: { id: string }; actions: { name: string; cli: string }[] };

const plan = {
  summary: "Measure the drop-off, then fix the biggest friction point.",
  description: "Read the onboarding funnel, pick the worst step, ship the smallest change behind a flag, compare before and after.",
  reading: "Learners who sign up but don't finish the first lesson within 24 hours.",
  assumptions: "The sign-up to first-lesson data exists; fix means the first-run flow, not the content.",
  uncertainties: "Whether a copy fix is wanted or a redesign of the flow.",
  steps: ["Measure where learners leave", "List the top 3 friction points", "Pick the highest-impact one", "Ship the smallest change behind a flag", "Compare before and after"],
  estimateMinutes: 240,
  risk: "medium",
  confidence: "medium",
};

/**
 * Plan review (#plan-review, docs/plan-review.md): a complex issue's award
 * opens plan review instead of an offer. ada files it and dana converts it
 * as complex; bob bids and ada awards: the claim is planning, the issue is at
 * In progress · Plan review, and bob's feed asks for the plan. Only bob can
 * submit it; once submitted it waits on bob's owner (plan_waiting). The owner's
 * approval is browser-only, so this scenario ends with bob releasing the
 * award, which sends the issue back to Open; the awarded bid is spent (as
 * after an expired offer) and bob bids afresh.
 */
describe("plan review on a complex issue", () => {
  let id: string;
  let bobBid: string;
  let claimId: string;

  const items = async (agent: Agent) => (await ok(agent, "work")).items as Item[];
  const byKey = async (agent: Agent, key: string) => (await items(agent)).find((item) => item.key === key);

  beforeAll(async () => {
    id = await fileIssue("ada", "CLI plan review: learners drop off during onboarding", ["bob", "cara", "eli"], "complex");
    await confirm(id, ["bob", "cara"]);
  });

  it("is converted as complex, which can be changed until the first bid and refuses a stake", async () => {
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ difficulty: "complex", plan: null });
    expect(await ok("cara", "set-difficulty", { id, difficulty: "hard" })).toMatchObject({ difficulty: "hard", changed: true });
    expect(await ok("cara", "set-difficulty", { id, difficulty: "complex" })).toMatchObject({ difficulty: "complex", changed: true });
    const stake = await refused("cara", "stake-issue", { id, summary: "I'll take it.", description: "Fast." }, 409);
    expect(stake).toMatchObject({ error: "not_stakeable", reason: "complex" });
  });

  it("locks the difficulty once there is a bid", async () => {
    bobBid = (await ok("bob", "bid", { id, summary: "I can fix the onboarding drop-off.", description: "Funnel first, then the smallest change behind a flag." })).bid_id;
    expect((await refused("cara", "set-difficulty", { id, difficulty: "easy" }, 409)).error).toBe("difficulty_locked");
  });

  it("opens plan review on the award instead of an offer", async () => {
    const awarded = await ok("ada", "award-bid", { id: bobBid });
    expect(awarded).toMatchObject({ bidId: bobBid, bugId: id, status: "planning" });
    expect(typeof awarded.planBy).toBe("string");
    claimId = awarded.claimId as string;
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({
      status: "in_progress",
      substatus: "plan_review",
      holder: { status: "planning", via: "bid", agentName: "bob" },
    });
    // No offer anywhere, and nobody else can award meanwhile.
    expect(await byKey("bob", `offer:${claimId}`)).toBeUndefined();
    await refused("dana", "award-bid", { id: bobBid }, 409);
    const item = await byKey("bob", `write_plan:${claimId}`);
    expect(item).toMatchObject({ kind: "write_plan", canAct: true, issue: { id } });
    expect(item!.actions.map((action) => action.name)).toEqual(["read_plan", "plan"]);
    expect((await ok("bob", "work")).ask.join(" ")).toMatch(/plan/);
  });

  it("takes the plan from the awarded agent only, then waits on its owner", async () => {
    expect((await refused("cara", "submit-plan", { id, ...plan }, 409)).error).toBe("not_holder");
    const submitted = await ok("bob", "submit-plan", { id, ...plan });
    expect(submitted).toMatchObject({ round: 1, status: "waiting" });
    const read = await ok("ada", "get-plan", { id });
    expect(read.plan).toMatchObject({ round: 1, decision: null, live: true, agentName: "bob", estimateMinutes: 240, risk: "medium", sendBacksLeft: 2 });
    expect((read.plan as { steps: { text: string; by: string }[] }).steps.map((step) => step.by)).toEqual(["agent", "agent", "agent", "agent", "agent"]);
    expect(typeof read.deadline).toBe("string");
    const waiting = await byKey("bob", `plan_waiting:${claimId}`);
    expect(waiting).toMatchObject({ kind: "plan_waiting", canAct: false });
    expect(await byKey("bob", `write_plan:${claimId}`)).toBeUndefined();
    // Nothing was sent back, so there is nothing to refuse.
    expect((await refused("bob", "refuse-plan", { id }, 409)).error).toBe("plan_not_sent_back");
    // Submitting again while it waits replaces the plan in the same round.
    expect(await ok("bob", "submit-plan", { id, ...plan, estimateMinutes: 300 })).toMatchObject({ round: 1 });
    expect((await ok("ada", "get-plan", { id })).plan).toMatchObject({ round: 1, estimateMinutes: 300 });
  });

  it("goes back to Open when the agent gives the award up; the awarded bid is spent and bob bids afresh", async () => {
    expect(await ok("bob", "release-claim", { id, reason: "Not now." })).toMatchObject({ reason: "declined", reopened: true });
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "open", substatus: "open", holder: null });
    const listed = (await ok("ada", "list-bids", { id })).bids as { id: string }[];
    expect(listed.map((bid) => bid.id)).not.toContain(bobBid);
    expect(await byKey("cara", `ready_issue:${id}`)).toMatchObject({ kind: "ready_issue", canAct: true });
    // The same bid row, bid afresh (#745): awardable again, and the award opens plan review again.
    expect((await ok("bob", "bid", { id, summary: "Still up for it.", description: "Same plan, fresh bid." })).bid_id).toBe(bobBid);
    expect(await byKey("ada", `award_bid:${id}`)).toMatchObject({ kind: "award_bid" });
  });
});
