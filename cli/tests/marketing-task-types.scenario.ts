import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ok, refused, unique } from "./helpers";

/**
 * Marketing task types (M-API-7, docs/ziki-for-agents.md, "Marketing task
 * types"): any agent may list them, only an owner's or admin's agent may change
 * them (ada's owner owns the sandbox workspace, bob's is a member), a retired
 * type can't be proposed with, and a type a proposal uses can't be deleted.
 */
let project: string;

beforeAll(async () => {
  project = (await ok("ada", "whoami")).project_id as string;
  expect(project).toBeTruthy();
});

const proposal = (label: string, typeId: string) => ({
  title: unique(label),
  summary: "A short post explaining what changed in the issue list.\nPeople keep asking about it.",
  description: "Write and publish a post for people who already use the issue list.",
  track: "marketing",
  rationale: "People keep asking what changed, and a post answers them all at once.",
  typeId,
  idempotencyKey: randomUUID(),
  acknowledgeSimilar: true,
});

describe("marketing task types", () => {
  it("lets an admin's agent create one that every agent can list", async () => {
    const name = unique("CLI type");
    const created = await ok("ada", "create-marketing-task-type", { id: project, name, description: "A post on the blog." });
    expect(created.taskType).toMatchObject({ name, description: "A post on the blog.", isActive: true, track: "marketing" });

    const listed = await ok("bob", "list-marketing-task-types", { id: project });
    expect((listed.taskTypes as { id: string }[]).map((type) => type.id)).toContain(created.taskType.id);
  });

  it("refuses changes from a member's agent", async () => {
    const body = await refused("bob", "create-marketing-task-type", { id: project, name: unique("CLI member type") }, 403);
    expect(body.error).toContain("owners and admins");
    await refused("bob", "list-marketing-task-types", { id: project, includeInactive: true }, 403);
  });

  it("refuses a name already used in the workspace, ignoring case", async () => {
    const name = unique("CLI dup type");
    await ok("ada", "create-marketing-task-type", { id: project, name });
    const body = await refused("ada", "create-marketing-task-type", { id: project, name: name.toUpperCase() }, 409);
    expect(body).toMatchObject({ error: "duplicate_name", field: "name" });
  });

  it("renames a type, and a retired one can't be proposed with", async () => {
    const created = await ok("ada", "create-marketing-task-type", { id: project, name: unique("CLI retire type") });
    const typeId = created.taskType.id as string;

    const renamed = await ok("ada", "update-marketing-task-type", { id: project, typeId, name: unique("CLI renamed type") });
    expect(renamed.taskType.id).toBe(typeId);

    await ok("ada", "create-idea", proposal("CLI marketing: with an active type", typeId));
    const retired = await ok("ada", "update-marketing-task-type", { id: project, typeId, isActive: false });
    expect(retired.taskType.isActive).toBe(false);
    const listed = await ok("bob", "list-marketing-task-types", { id: project });
    expect((listed.taskTypes as { id: string }[]).map((type) => type.id)).not.toContain(typeId);

    const refusedIdea = await refused("ada", "create-idea", proposal("CLI marketing: with a retired type", typeId), 422);
    expect(refusedIdea).toMatchObject({ error: "invalid_type" });

    // The proposal filed while it was active still uses it, so it can't be deleted.
    const inUse = await refused("ada", "delete-marketing-task-type", { id: project, typeId }, 409);
    expect(inUse).toMatchObject({ error: "type_in_use", ideas: 1 });
  });

  it("deletes a type nothing uses", async () => {
    const created = await ok("ada", "create-marketing-task-type", { id: project, name: unique("CLI unused type") });
    const deleted = await ok("ada", "delete-marketing-task-type", { id: project, typeId: created.taskType.id });
    expect(deleted).toEqual({ id: created.taskType.id, deleted: true });
    await refused("ada", "update-marketing-task-type", { id: project, typeId: created.taskType.id, isActive: true }, 404);
  });
});

describe("the project brief", () => {
  it("is in the agent's identity and only on the marketing feed", async () => {
    const me = await ok("ada", "whoami");
    expect(me).toHaveProperty("brief");
    const marketing = await ok("ada", "get-work", { track: "marketing" });
    expect(marketing).toHaveProperty("brief");
    const product = await ok("ada", "get-work");
    expect(product).not.toHaveProperty("brief");
  });
});
