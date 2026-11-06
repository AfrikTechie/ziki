import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { fileIssue, ok, refused, unique } from "./helpers";

/**
 * Proposing a marketing task (docs/ziki-for-agents.md, "Propose a marketing
 * task"): an ordinary idea with track=marketing and a rationale. The rationale
 * is required on marketing work and refused on product work, and a marketing
 * task type fits only a marketing idea.
 */
const task = (label: string) => ({
  title: unique(label),
  summary: "A short post explaining what changed in the issue list.\nPeople keep asking about it.",
  description: "Write and publish a post for people who already use the issue list.",
  idempotencyKey: randomUUID(),
  acknowledgeSimilar: true,
});

/** A marketing task type of this sandbox's own: the Demo workspace's types belong to that workspace. */
let marketingTypeId: string;

beforeAll(async () => {
  const project = (await ok("ada", "whoami")).project_id as string;
  marketingTypeId = (await ok("ada", "create-marketing-task-type", { id: project, name: unique("CLI blog post") })).taskType.id as string;
});

describe("proposing a marketing task", () => {
  it("files a marketing idea with its rationale and task type", async () => {
    const created = await ok("ada", "create-idea", {
      ...task("CLI marketing: launch post for the issue list"),
      track: "marketing",
      rationale: "People keep asking what changed, and a post answers them all at once.",
      typeId: marketingTypeId,
    });
    expect(created.idea).toMatchObject({
      track: "marketing",
      rationale: "People keep asking what changed, and a post answers them all at once.",
      typeId: marketingTypeId,
      status: "open",
    });
  });

  it("refuses a marketing idea without a rationale, and a product idea with one", async () => {
    const missing = await refused("ada", "create-idea", { ...task("CLI marketing: no rationale"), track: "marketing" }, 400);
    expect(missing).toMatchObject({ error: "invalid_request", field: "rationale" });
    const product = await refused("ada", "create-idea", { ...task("CLI marketing: product with rationale"), rationale: "Because." }, 400);
    expect(product).toMatchObject({ error: "invalid_request", field: "rationale" });
  });

  it("refuses a marketing task type on a product idea", async () => {
    const wrong = await refused("ada", "create-idea", { ...task("CLI marketing: type on product"), typeId: marketingTypeId }, 422);
    expect(wrong).toMatchObject({ error: "wrong_track" });
  });
});

describe("listing issues by track", () => {
  it("lists matching issues from only the requested track", async () => {
    const marker = unique("CLI track filter search");
    const productIssueId = await fileIssue("ada", `${marker} product`, ["bob", "cara", "eli"]);
    const proposal = await ok("ada", "create-idea", {
      ...task(`${marker} marketing`),
      track: "marketing",
      rationale: "A distinct marketing deliverable for this project.",
    });
    const ideaId = proposal.idea.id as string;
    // A marketing idea opens on the verdict that reaches its threshold, so no agent converts it.
    let marketingIssueId: string | undefined;
    for (const agent of ["bob", "cara", "eli"] as const) {
      const given = await ok(agent, "give-idea-verdict", {
        id: ideaId,
        opinion: "good",
        summary: "Worth doing.",
        description: "This marketing task is worth publishing.",
      });
      if (given.decided?.outcome === "converted") {
        marketingIssueId = given.decided.issueId as string;
        break;
      }
    }
    expect(marketingIssueId).toBeTruthy();

    const productIssue = (await ok("ada", "get-issue", { id: productIssueId })).issue;
    const marketingIssue = (await ok("ada", "get-issue", { id: marketingIssueId! })).issue;
    const projectId = productIssue.projectId as string;
    expect(marketingIssue.projectId).toBe(projectId);

    const productPage = await ok("ada", "list-issues", { projectId, track: "product", q: marker });
    const marketingPage = await ok("ada", "list-issues", { projectId, track: "marketing", q: marker });

    expect(productPage.items.some((item: { id: string; track: string }) => item.id === productIssueId && item.track === "product")).toBe(true);
    expect(productPage.items.every((item: { track: string }) => item.track === "product")).toBe(true);
    expect(marketingPage.items.some((item: { id: string; track: string }) => item.id === marketingIssueId && item.track === "marketing")).toBe(true);
    expect(marketingPage.items.every((item: { track: string }) => item.track === "marketing")).toBe(true);
  });
});
