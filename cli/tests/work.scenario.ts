import { beforeAll, describe, expect, it } from "vitest";
import { readKeyring } from "../keyring";
import { confirm, fileIdea, fileIssue, offeredTo, ok, refused, ziki, type Agent } from "./helpers";

type Item = { kind: string; key: string; minimumRole: string; canAct: boolean; blockedReason?: string; points?: number; issue?: { id: string }; idea?: { id: string }; actions: { name: string; cli: string }[] };

/** The one work list every agent watches: `/<org>/<project>/work`, or `pnpm ziki work`. */
describe("the work feed", () => {
  let slug: string;
  let org: string;

  beforeAll(async () => {
    const me = await ok("ada", "whoami");
    slug = me.project_slug;
    org = me.org_slug;
  });

  const work = async (agent: Agent) => (await ok(agent, "work")) as { items: Item[]; ask: string[]; workUrl: string; pollAfterSeconds: number; agent: { level: string } };
  const itemFor = (items: Item[], kind: string, id: string) => items.find((item) => item.kind === kind && (item.issue?.id ?? item.idea?.id) === id);
  const ideaPoints = async (agent: Agent, ideaId: string) =>
    ((await ok(agent, "list-point-entries", { limit: 100 })).items as { role: string; points: number; idea: { id: string } | null }[])
      .filter((entry) => entry.role === "idea" && entry.idea?.id === ideaId)
      .reduce((sum, entry) => sum + entry.points, 0);

  it("lists no owner request it wasn't given, and refuses to mark an unknown one done (#agent-requests)", async () => {
    expect((await work("ada")).items.some((item) => item.kind === "owner_request")).toBe(false);
    expect(await refused("ada", "complete-request", { id: "no-such-request" }, 404)).toMatchObject({ error: expect.any(String) });
  });

  it("counts issues per status and ideas per idea status, the numbers the tabs show", async () => {
    const counts = await ok("bob", "count-issues");
    const statuses = ["open", "in_progress", "done", "merge", "resolved", "closed"];
    expect(Object.keys(counts.issues).sort()).toEqual([...statuses, "all"].sort());
    expect(counts.issues.all).toBe(statuses.reduce((sum, status) => sum + counts.issues[status], 0));
    // The substatuses split the same issues (#substatus).
    const substatusTotal = Object.values(counts.substatuses as Record<string, number>).reduce((sum, n) => sum + n, 0);
    expect(substatusTotal).toBe(counts.issues.all);
    expect(Object.keys(counts.ideas).sort()).toEqual(["archived", "converted", "open", "rejected"]);
    // The same issues the list returns for that status.
    const open = await ok("bob", "list-issues", { status: "open", limit: 100 });
    expect(open.items.length).toBe(Math.min(counts.issues.open, 100));
  });

  it("is what a connecting agent is told to watch", async () => {
    const me = await ok("bob", "whoami");
    expect(me.work_url).toMatch(new RegExp(`/${org}/${slug}/work$`));
    expect(me.next_step).toMatch(/work_url/);
    const feed = await work("bob");
    expect(feed.workUrl).toBe(me.work_url);
    expect(feed.pollAfterSeconds).toBe(30);
  });

  it("answers at the short URL, and 304 when nothing changed", async () => {
    const { serverUrl, agents } = readKeyring();
    const url = `${serverUrl}/${org}/${slug}/work`;
    const headers = { Authorization: `Bearer ${agents.bob.key}` };
    const first = await fetch(url, { headers });
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const again = await fetch(url, { headers: { ...headers, "If-None-Match": etag! } });
    expect(again.status).toBe(304);
    expect((await fetch(url, { headers: { Authorization: "Bearer ziki_not_a_key" } })).status).toBe(401);
  });

  it("shows a new idea at once and asks for a verdict, the reporter's own agents included", async () => {
    const idea = await fileIdea("ada", "Work feed: an idea for verdicts");
    const bobs = await work("bob");
    const item = itemFor(bobs.items, "idea", idea);
    expect(item, "the new idea is in bob's list straight away").toBeTruthy();
    expect(item!.points).toBe(0.01);
    expect(item!.actions.map((action) => action.name)).toEqual(["give_idea_verdict"]);
    expect(bobs.ask.join(" ")).toMatch(/verdict/);
    expect(itemFor((await work("ada")).items, "idea", idea), "an owner may give a verdict on their own idea").toBeTruthy();
  });

  it("pays $0.01 for the first verdict on an idea, once per person; an idea is not an issue to comment on", async () => {
    const idea = await fileIdea("ada", "Work feed: an idea worth one point");
    // An idea takes only verdicts: there is no issue to comment on.
    await refused("bob", "comment", { id: idea, summary: "A short comment.", body: "A plain comment on an idea." }, 404);
    expect(await ideaPoints("bob", idea)).toBe(0);
    await ok("bob", "give-idea-verdict", { id: idea, opinion: "good", summary: "It keeps the draft.", description: "The current flow loses the draft on reload." });
    expect(await ideaPoints("bob", idea)).toBe(0.01);
    await ok("bob", "give-idea-verdict", { id: idea, opinion: "neutral", summary: "On second thought, unsure.", description: "Changing my verdict pays nothing more." });
    expect(await ideaPoints("bob", idea)).toBe(0.01);
    expect(itemFor((await work("bob")).items, "idea", idea), "given a verdict, so it leaves bob's list").toBeUndefined();
  });

  it("asks any agent to convert an idea at the threshold, then lists it to confirm", async () => {
    const idea = await fileIdea("ada", "Work feed: an idea to convert");
    await ok("bob", "give-idea-verdict", { id: idea, opinion: "good", summary: "Yes.", description: "Good idea." });
    expect(itemFor((await work("dana")).items, "convert_idea", idea), "below the threshold, nothing to convert").toBeUndefined();
    await ok("eli", "give-idea-verdict", { id: idea, opinion: "good", votes: 2, summary: "Yes. Clear win.", description: "A merger agent may give up to 5." });
    const forBob = itemFor((await work("bob")).items, "convert_idea", idea);
    expect(forBob).toMatchObject({ minimumRole: "working", canAct: true });
    const forDana = itemFor((await work("dana")).items, "convert_idea", idea);
    expect(forDana).toMatchObject({ canAct: true });
    expect((await work("bob")).ask.join(" ")).toMatch(/convert/);
    const { issueId } = await ok("bob", "convert-idea", { id: idea });
    const confirmItem = itemFor((await work("cara")).items, "confirm_issue", issueId);
    expect(confirmItem?.actions.map((action) => action.name)).toEqual(["confirm_issue"]);
    expect(itemFor((await work("cara")).items, "idea", idea)).toBeUndefined();
  });

  it("lists offers to the agent and then its claim, with what to do next", async () => {
    const issue = await fileIssue("ada", "Work feed: an issue to offer", ["bob", "cara", "eli"]);
    await confirm(issue, ["bob", "cara"]);

    // A confirmed issue is listed to bid on; it is offered only once a manager agent awards a bid.
    expect(await offeredTo(issue)).toBeNull();
    const ready = itemFor((await work("bob")).items, "ready_issue", issue);
    expect(ready, "ready issues are listed to bid on").toBeTruthy();
    expect(ready!.actions.map((action) => action.name)).toEqual(["stake", "bid"]);
    const bid = await ok("bob", "bid", { id: issue, summary: "I can fix this.", description: "I will reproduce it, fix it and add a test." });
    // dana's vote counts 3, the award threshold: any agent may then award the bid.
    await ok("dana", "vote-bid", { id: bid.bid_id });
    const awarded = await ok("dana", "award-bid", { id: bid.bid_id });
    const offered = (await work("bob")).items.find((item) => item.key === `offer:${awarded.claimId}`);
    expect(offered?.issue?.id).toBe(issue);
    expect(offered?.actions[0].cli).toBe(`accept-offer --id ${awarded.claimId}`);
    await ok("bob", "accept-offer", { id: awarded.claimId });
    const claim = itemFor((await work("bob")).items, "active_claim", issue);
    expect(claim?.actions.map((action) => action.name)).toEqual(["heartbeat", "deliver", "release_claim"]);
    await ok("bob", "release-claim", { id: issue, reason: "Done testing the feed." });
  });

  it("shows manager and merger tasks to everyone, but only lets those classes act", async () => {
    for (const agent of ["bob", "dana", "eli"] as const) {
      const feed = await work(agent);
      for (const item of feed.items) {
        const rank = { working: 0, manager: 1, merger: 2 } as Record<string, number>;
        if (rank[item.minimumRole] > rank[feed.agent.level]) {
          expect(item.canAct, `${agent} must not act on ${item.key}`).toBe(false);
          expect(item.blockedReason).toBe(`Needs a ${item.minimumRole} agent.`);
        }
        if (!item.canAct) expect(item.blockedReason).toBeTruthy();
      }
    }
    const roles = new Map((await work("bob")).items.map((item) => [item.kind, item.minimumRole]));
    if (roles.has("merge_fix")) expect(roles.get("merge_fix")).toBe("merger");
    if (roles.has("accept_fix")) expect(roles.get("accept_fix")).toBe("manager");
    if (roles.has("award_bid")) expect(roles.get("award_bid")).toBe("working");
    if (roles.has("close_issue")) expect(roles.get("close_issue")).toBe("manager");
    if (roles.has("review_bid")) expect(roles.get("review_bid")).toBe("working");
    expect(roles.has("dispatch")).toBe(false);
  });

  it("refuses another project's work and needs a key", async () => {
    await refused("bob", "work", { projectId: "no-such-project" }, 404);
    const unknown = await ziki("work", "--as", "zoe");
    expect(unknown.code).toBe(2);
  });
});
