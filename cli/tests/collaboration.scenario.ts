import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { confirm, feedItem, fileIssue, offeredTo, ok, refused, unique, ziki } from "./helpers";

/** Talking about an issue and lining up work on it, through the CLI. */
describe("working on issues together", () => {
  let id: string;
  /** A converted issue still at Requires confirmation, filed once and reused. */
  let fresh: string;

  beforeAll(async () => {
    // Replies are for issue entries; ideas take only verdicts.
    id = await fileIssue("cara", "CLI collaboration: list goes blank", ["ada", "bob", "eli"]);
  });

  it("takes a comment on the issue itself at any stage, before it is confirmed too", async () => {
    const { comment } = await ok("bob", "comment", { id, summary: "A short comment.", body: "I can reproduce this on Firefox." });
    expect(comment).toMatchObject({ parentId: null, bidId: null, confirmationId: null });
  });

  it("refuses typed comments and metadata with a 400 that lists the entry routes", async () => {
    const { projectId } = (await ok("ada", "get-issue", { id })).issue;
    const typed = await ziki(
      "request", "POST", `/api/v1/issues/${id}/comments?projectId=${projectId}`,
      "--body", JSON.stringify({ body: "Root cause found in the list query.", type: "review", metadata: { confidence: 80 } }),
      "--as", "bob",
    );
    expect(typed.code).toBe(1);
    expect(typed.json?.status).toBe(400);
    expect(typed.out + typed.err).toMatch(/comment_has_no_type/);
    expect(typed.out + typed.err).toMatch(/test-results/);
  });

  it("takes bids while the issue awaits confirmation", async () => {
    const early = await ok("ada", "bid", { id, summary: "I can look at this now.", description: "Bidding before it is confirmed; awarding waits for confirmation." });
    expect(early.bid_id).toBeTruthy();
    await ok("ada", "withdraw-bid", { id });
  });

  it("takes bids once the issue is ready (converted and confirmed): summary and description required, a new bid replaces, replies and withdraw work", async () => {
    await confirm(id, ["ada", "bob"]);
    // A confirmed issue is not offered automatically, so it is open to bids.
    expect(await offeredTo(id)).toBeNull();
    // A bare bid is refused: every entry explains itself.
    const { projectId } = (await ok("eli", "get-issue", { id })).issue;
    const bare = await ziki("request", "POST", `/api/v1/issues/${id}/bid?projectId=${projectId}`, "--body", JSON.stringify({}), "--as", "eli");
    expect(bare.code).toBe(1);
    expect(bare.json?.status).toBe(400);
    expect(bare.out + bare.err).toMatch(/summary/);
    const bid = await ok("eli", "bid", { id, summary: "I can fix this today.", description: "The list query drops rows after a deploy; I will fix the cache key and add a test." });
    expect(bid.bid_id).toBeTruthy();
    expect(bid.replaced).toBe(false);
    // Bidding again replaces the same bid.
    const again = await ok("eli", "bid", { id, summary: "I can fix this within the hour.", description: "Same plan, sooner." });
    expect(again).toMatchObject({ bid_id: bid.bid_id, replaced: true, summary: "I can fix this within the hour." });
    const reply = await ok("cara", "comment", { id, summary: "A short comment.", body: "Please include a regression test.", bidId: bid.bid_id });
    expect(reply.comment).toMatchObject({ bidId: bid.bid_id, parentId: null });
    const listed = JSON.stringify(await ok("cara", "list-bids", { id }));
    expect(listed).toContain(bid.bid_id);
    expect(listed).toContain("I can fix this within the hour.");
    expect(listed).toContain("Please include a regression test.");
    await ok("eli", "withdraw-bid", { id });
    expect(JSON.stringify(await ok("cara", "list-bids", { id }))).not.toContain(bid.bid_id);
  });

  it("takes comments on the issue itself, and one-level replies to them", async () => {
    const { comment } = await ok("bob", "comment", { id, summary: "A short comment.", body: "Still blank on Firefox 131 after the deploy." });
    expect(comment).toMatchObject({ parentId: null, bidId: null, confirmationId: null });
    const { comment: reply } = await ok("cara", "comment", { id, summary: "A short comment.", body: "Thanks, that narrows it down.", parentId: comment.id });
    expect(reply.parentId).toBe(comment.id);
    // Replies are one level deep.
    await refused("ada", "comment", { id, summary: "A short comment.", body: "Me too.", parentId: reply.id }, 422);
    // One place per comment.
    await refused("ada", "comment", { id, summary: "A short comment.", body: "Me too.", parentId: comment.id, confirmationId: "c0000000000000000000000000" }, 422);
  });

  it("releases a claim it no longer wants, so the issue goes back to Open for bids", async () => {
    // Offers come only from an awarded bid: bob bids, dana (a manager agent) votes it to the threshold and awards it, bob accepts.
    const bid = await ok("bob", "bid", { id, summary: "I can take this.", description: "I will fix the cache key and add a regression test." });
    // dana's vote counts 3, the award threshold: any agent may then award the bid.
    await ok("dana", "vote-bid", { id: bid.bid_id });
    const awarded = await ok("dana", "award-bid", { id: bid.bid_id });
    await ok("bob", "accept-offer", { id: awarded.claimId });
    const released = await ok("bob", "release-claim", { id, reason: "Out of time this week." });
    expect(released).toMatchObject({ claimId: awarded.claimId, reopened: true });
    expect(released).not.toHaveProperty("reofferedTo");
    // Nobody is offered it in turn.
    expect(await offeredTo(id)).toBeNull();
    expect((await ok("ada", "get-issue", { id })).issue).toMatchObject({ status: "open", holder: null });
  });

  it("asks the owner a question and reads it back", async () => {
    const asked = await ok("bob", "ask-owner", { body: "Should the fix also cover the mobile list?", bugId: id });
    const questionId = asked.question?.id ?? asked.id;
    expect(questionId, JSON.stringify(asked)).toBeTruthy();
    expect(JSON.stringify(await ok("bob", "get-question", { id: questionId }))).toContain("mobile list");
  });

  it("escalates a blocker and reads the escalation back", async () => {
    const escalated = await ok("bob", "escalate", { body: "Blocked: the staging database is down.", bugId: id, type: "blocker" });
    const escalationId = escalated.question?.id ?? escalated.escalation?.id ?? escalated.id;
    expect(escalationId, JSON.stringify(escalated)).toBeTruthy();
    expect(JSON.stringify(await ok("bob", "get-escalation", { id: escalationId }))).toContain("staging database");
  });

  it("reads the inbox and marks it read", async () => {
    const inbox = await ok("cara", "read-inbox");
    expect(Array.isArray(inbox.items), JSON.stringify(inbox)).toBe(true);
    const ids = (inbox.items as { id: string }[]).map((item) => item.id);
    if (ids.length) expect(await ok("cara", "mark-inbox-read", { ids })).toBeTruthy();
    const unread = await ok("cara", "read-inbox", { unread: true });
    expect((unread.items ?? []).length).toBe(0);
  });

  it("pages the inbox with cursor and nextCursor, and refuses a misnamed cursor instead of repeating page one (#inbox-paging)", async () => {
    const first = await ok("cara", "read-inbox");
    expect(first).toHaveProperty("nextCursor");
    expect(first).toHaveProperty("hasMore");
    if (first.nextCursor) {
      const next = await ok("cara", "read-inbox", { cursor: first.nextCursor });
      const firstIds = new Set((first.items as { id: string }[]).map((item) => item.id));
      expect((next.items as { id: string }[]).some((item) => firstIds.has(item.id))).toBe(false);
    }
    const misnamed = await ziki("request", "GET", "/api/v1/inbox?after=anything", "--as", "cara");
    expect(misnamed.code).toBe(1);
    expect(misnamed.json?.status).toBe(400);
  });

  it("follows the project through the feed and polled events", async () => {
    const feed = await ok("ada", "read-feed");
    expect(feed).toBeTruthy();
    const events = await ok("ada", "poll-events", { wait: 0 });
    expect(JSON.stringify(events)).toMatch(/issue\./);
  });

  it("lists a converted issue to confirm in the work feed, the one queue (#714)", async () => {
    // Ideas take verdicts; the feed lists the issue to confirm once converting creates it.
    fresh = await fileIssue("ada", "CLI collaboration: needs confirming", ["bob", "cara", "eli"]);
    const item = await feedItem("bob", "confirm_issue", fresh);
    expect(item?.actions?.map((action) => action.name)).toEqual(["confirm_issue"]);
  });

  it("structures an agent's report, and marks a duplicate through structuring", async () => {
    // The issue the work-feed test filed is still a draft at Requires confirmation.
    const structured = await ok("bob", "structure-issue", {
      id: fresh,
      stepsToReproduce: "1. Open the list. 2. Scroll.",
      expectedBehavior: "Rows stay visible.",
      actualBehavior: "The list goes blank.",
    });
    expect(JSON.stringify(structured)).toMatch(/Rows stay visible|structured|issue/);
    const duplicate = await fileIssue("ada", "CLI collaboration: the same blank list", ["bob", "cara", "eli"]);
    const marked = await ok("bob", "structure-issue", { id: duplicate, duplicateOfId: id });
    expect(JSON.stringify(marked)).toContain(id);
  });

  it("proposes a redesign for a person to decide", async () => {
    const proposed = await ok("bob", "propose-redesign", {
      bugId: id,
      title: unique("Redesign the list"),
      body: "Use a virtualised list so long pages stay fast.",
    });
    expect(JSON.stringify(proposed)).toMatch(/proposed|redesign/i);
  });

  it("uploads an attachment and files an idea with it", async () => {
    // A 1×1 transparent PNG.
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const uploaded = await ok("ada", "upload-attachment", { filename: "screenshot.png", dataBase64: png });
    const attachmentId = uploaded.attachment?.id ?? uploaded.id;
    expect(attachmentId, JSON.stringify(uploaded)).toBeTruthy();
    const created = await ok("ada", "create-idea", {
      title: unique("CLI collaboration: with a screenshot"),
      summary: "The page shows an error instead of loading.\nThe screenshot shows the message.",
      description: "Steps: open it. Expected: it works. Actual: see the screenshot.",
      attachmentIds: [attachmentId],
      acknowledgeSimilar: true,
    });
    expect(JSON.stringify(created.idea.attachments)).toContain(attachmentId);
    // #722: agents read the file back with their key, at the URL the idea gives; any agent in the organisation may.
    const file = created.idea.attachments.find((entry: { id: string }) => entry.id === attachmentId);
    expect(file.url).toBe(`/api/v1/attachments/${attachmentId}`);
    const reads = await Promise.all((["ada", "bob"] as const).map((reader) => ziki("request", "GET", file.url, "--as", reader)));
    for (const read of reads) expect(read.code, read.err).toBe(0);
    const missing = await ziki("request", "GET", "/api/v1/attachments/not-a-file", "--as", "bob");
    expect(missing.out + missing.err).toMatch(/not_found|404/);
    // The short summary is kept, for people to read at a glance (#report-summary).
    expect(created.idea.summary).toBe("The page shows an error instead of loading.\nThe screenshot shows the message.");
  });

  it("needs a short plain summary on every report (#report-summary)", async () => {
    const missing = await ziki("create-idea", "--title", unique("CLI collaboration: no summary"), "--description", "Steps: open it. Expected: it works. Actual: it fails.", "--as", "ada");
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/--summary/);
    const markdown = await refused("ada", "create-idea", {
      title: unique("CLI collaboration: markdown summary"),
      summary: "## Bug\n**Save** does nothing on the page.",
      description: "Steps: open it. Expected: it works. Actual: it fails.",
      acknowledgeSimilar: true,
    }, 422);
    expect(JSON.stringify(markdown)).toMatch(/plain text/);
  });

  it("warns before filing a report like an open idea, and files it once acknowledged", async () => {
    const title = unique("CLI collaboration: duplicate check");
    const description = "Steps: open the page and press Save. Expected: it saves. Actual: nothing happens.";
    const summary = "Pressing Save on the page does nothing.";
    await ok("ada", "create-idea", { title, summary, description, acknowledgeSimilar: true });
    const idempotencyKey = randomUUID();
    const warned = await refused("bob", "create-idea", { title, summary, description, idempotencyKey }, 409);
    expect(warned.error).toBe("similar_issues");
    expect(warned.matches[0]).toMatchObject({ title, kind: "idea" });
    const filed = await ok("bob", "create-idea", { title, summary, description, idempotencyKey, acknowledgeSimilar: true });
    expect(filed.idea.title).toBe(title);
  });
});
