import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Per-user agent preferences (#838): an instruction belongs to one person, every key of theirs reads the same set, and nobody else's rows are reachable at all. */
const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  agentPreference: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

/** The rate limit is out of scope here; every call is simply allowed. */
const mocks = vi.hoisted(() => ({ budget: vi.fn() }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({
  ...(await original<typeof import("@/lib/agents/rate-budget")>()),
  consumeAgentBudget: mocks.budget,
}));

import {
  createAgentPreference,
  deleteAgentPreference,
  listAgentPreferences,
  updateAgentPreference,
} from "@/lib/agent-preferences";
import { AGENT_PREFERENCES_MAX, AGENT_PREFERENCE_CONTENT_MAX } from "@/lib/validations/agent-preferences";
import { GET, POST } from "@/app/api/v1/agents/me/preferences/route";
import { PATCH, DELETE } from "@/app/api/v1/agents/me/preferences/[id]/route";

const row = { id: "pref-1", content: "Run the tests.", createdAt: new Date(), updatedAt: new Date() };

/** A live key for an agent of `owner`, shaped the way requireAgent reads it. */
function keyFor(agentId: string, ownerUserId = "owner-1") {
  return {
    id: `key-${agentId}`,
    lastUsedAt: null,
    revokedAt: null,
    projectId: null,
    project: null,
    agent: {
      id: agentId,
      name: "Worker",
      ownerUserId,
      organisationId: "organisation-1",
      level: "working",
      burst: false,
      burstUntil: null,
      revokedAt: null,
      username: "worker",
      tagline: "Test agent",
      about: "A test agent.",
      _count: { skills: 1 },
      owner: { role: "user", memberships: [{ organisationId: "organisation-1" }] },
    },
  };
}

/** The route's own address; the key is what identifies the caller, not the URL. */
const url = "http://localhost/api/v1/agents/me/preferences";

function get(key: string | null = "ziki_test") {
  return new NextRequest(url, { headers: key ? { authorization: `Bearer ${key}` } : {} });
}
function post(body: unknown, key: string | null = "ziki_test") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
}
function byId(method: "PATCH" | "DELETE", id: string, body?: unknown) {
  return new NextRequest(`${url}/${id}`, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer ziki_test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
  db.agentApiKey.findUnique.mockResolvedValue(keyFor("agent-one"));
  db.agentAuditEvent.create.mockResolvedValue({});
  db.agentPreference.findMany.mockResolvedValue([row]);
  db.agentPreference.findUnique.mockResolvedValue(row);
  db.agentPreference.count.mockResolvedValue(0);
  db.agentPreference.create.mockResolvedValue(row);
  db.agentPreference.updateMany.mockResolvedValue({ count: 1 });
  db.agentPreference.deleteMany.mockResolvedValue({ count: 1 });
  mocks.budget.mockResolvedValue({ allowed: true, remaining: 99 });
});

describe("who owns an instruction", () => {
  it("lists only the caller's rows", async () => {
    await listAgentPreferences("owner-1");

    expect(db.agentPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "owner-1" } }),
    );
  });

  it("writes a new one under the caller's id", async () => {
    await createAgentPreference("owner-1", { content: "Run the tests." });

    expect(db.agentPreference.create).toHaveBeenCalledWith({
      data: { userId: "owner-1", content: "Run the tests." },
      select: expect.objectContaining({ id: true, content: true }),
    });
  });

  it("refuses to change an id that is not the caller's, and never reads it back", async () => {
    db.agentPreference.updateMany.mockResolvedValue({ count: 0 });

    await expect(updateAgentPreference("owner-1", "someone-elses", { content: "mine" })).rejects.toMatchObject({
      status: 404,
    });
    expect(db.agentPreference.findUnique).not.toHaveBeenCalled();
  });

  it("refuses to delete an id that is not the caller's", async () => {
    db.agentPreference.deleteMany.mockResolvedValue({ count: 0 });

    await expect(deleteAgentPreference("owner-1", "someone-elses")).rejects.toMatchObject({ status: 404 });
    // Scoped in one call: a foreign id matches nothing rather than deleting it.
    expect(db.agentPreference.deleteMany).toHaveBeenCalledWith({ where: { id: "someone-elses", userId: "owner-1" } });
  });
});

describe("what an instruction may say", () => {
  it("refuses a blank one without touching the database", async () => {
    await expect(createAgentPreference("owner-1", { content: "   " })).rejects.toMatchObject({ name: "ZodError" });
    expect(db.agentPreference.create).not.toHaveBeenCalled();
  });

  it("refuses one longer than the standing brief allows", async () => {
    const tooLong = "x".repeat(AGENT_PREFERENCE_CONTENT_MAX + 1);

    await expect(createAgentPreference("owner-1", { content: tooLong })).rejects.toMatchObject({ name: "ZodError" });
    expect(db.agentPreference.create).not.toHaveBeenCalled();
  });

  it("refuses one past the cap instead of letting the list grow without bound", async () => {
    db.agentPreference.count.mockResolvedValue(AGENT_PREFERENCES_MAX);

    await expect(createAgentPreference("owner-1", { content: "one more" })).rejects.toMatchObject({ status: 409 });
    expect(db.agentPreference.create).not.toHaveBeenCalled();
  });

  it("saves an instruction exactly as written, trimmed", async () => {
    const saved = await createAgentPreference("owner-1", { content: "  Run the tests.  " });

    expect(saved).toEqual(row);
    expect(db.agentPreference.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: "owner-1", content: "Run the tests." } }),
    );
  });
});

describe("the agent API", () => {
  it("refuses a call with no key", async () => {
    const response = await GET(get(null));

    expect(response.status).toBe(401);
    expect(db.agentPreference.findMany).not.toHaveBeenCalled();
  });

  it("answers every key the owner has with the owner's own instructions", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(keyFor("agent-one"));
    const first = await GET(get());

    db.agentApiKey.findUnique.mockResolvedValue(keyFor("agent-two"));
    const second = await GET(get());

    // Two different agents, one owner: both read the same set, which is what
    // lets one set of instructions reach all of that person's agents.
    expect(db.agentPreference.findMany).toHaveBeenCalledTimes(2);
    for (const call of db.agentPreference.findMany.mock.calls) {
      expect(call[0]).toMatchObject({ where: { userId: "owner-1" } });
    }
    await expect(first.json()).resolves.toEqual({ preferences: [expect.objectContaining({ id: "pref-1" })] });
    await expect(second.json()).resolves.toEqual({ preferences: [expect.objectContaining({ id: "pref-1" })] });
  });

  it("never reads another owner's instructions", async () => {
    db.agentApiKey.findUnique.mockResolvedValue(keyFor("agent-one", "someone-else"));

    await GET(get());

    expect(db.agentPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "someone-else" } }),
    );
  });

  it("creates one for the owner the key belongs to", async () => {
    const response = await POST(post({ content: "Run the tests." }));

    expect(response.status).toBe(201);
    expect(db.agentPreference.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: "owner-1", content: "Run the tests." } }),
    );
    await expect(response.json()).resolves.toEqual({ preference: expect.objectContaining({ id: "pref-1" }) });
  });

  it("answers a blank instruction with 422 rather than storing it", async () => {
    const response = await POST(post({ content: "   " }));

    expect(response.status).toBe(422);
    expect(db.agentPreference.create).not.toHaveBeenCalled();
  });

  it("answers an instruction over the limit with 422", async () => {
    const response = await POST(post({ content: "x".repeat(AGENT_PREFERENCE_CONTENT_MAX + 1) }));

    expect(response.status).toBe(422);
    expect(db.agentPreference.create).not.toHaveBeenCalled();
  });

  it("deletes only the owner's own instruction, by the id in the path", async () => {
    const response = await DELETE(byId("DELETE", "pref-1"), context("pref-1"));

    expect(response.status).toBe(204);
    expect(db.agentPreference.deleteMany).toHaveBeenCalledWith({ where: { id: "pref-1", userId: "owner-1" } });
  });

  it("answers a foreign id with 404 through the route too", async () => {
    db.agentPreference.deleteMany.mockResolvedValue({ count: 0 });

    const response = await DELETE(byId("DELETE", "not-mine"), context("not-mine"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("replaces one instruction's text, scoped to the owner", async () => {
    const response = await PATCH(byId("PATCH", "pref-1", { content: "New text." }), context("pref-1"));

    expect(response.status).toBe(200);
    expect(db.agentPreference.updateMany).toHaveBeenCalledWith({
      where: { id: "pref-1", userId: "owner-1" },
      data: { content: "New text." },
    });
  });
});
