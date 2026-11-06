import { beforeEach, describe, expect, it, vi } from "vitest";

/** Event scope, subscriptions and SSRF (#405, #498, #512): event filters stay inside the key's organisation, subscriptions are capped per agent, and no webhook URL may reach a private address. */
const findFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { bug: { findFirst } } }));

import { scopeEventFilters, type EventFilters } from "@/lib/agent-api/events";
import { createSubscriptionRecord, MAX_SUBSCRIPTIONS_PER_AGENT } from "@/lib/webhooks/manage";
import { checkSsrf } from "@/lib/webhooks/ssrf";

const caller = { organisationId: "organisation-a" };

describe("scopeEventFilters organisation scope (#405, #user-agents)", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it("passes filters through: a key reads events from every project of its organisation", async () => {
    const filters: EventFilters = { projectId: "proj-web" };
    await expect(scopeEventFilters(caller, filters)).resolves.toEqual({ filters });
    findFirst.mockResolvedValue({ id: "issue-1" });
    await expect(scopeEventFilters(caller, { projectId: "proj-web", bugId: "issue-1" })).resolves.toEqual({ filters: { projectId: "proj-web", bugId: "issue-1" } });
  });

  it("answers 404 for a bugId that does not exist or belongs to another organisation", async () => {
    findFirst.mockResolvedValue(null);
    await expect(scopeEventFilters(caller, { bugId: "issue-missing" })).resolves.toEqual({ status: 404, error: "Issue not found." });
    await expect(scopeEventFilters(caller, { bugId: "issue-other-organisation" })).resolves.toEqual({ status: 404, error: "Issue not found." });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "issue-other-organisation", organisationId: "organisation-a" }, select: { id: true } });
  });
});

const db = {
  webhookSubscription: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)),
  $queryRaw: vi.fn(),
};

const input = {
  agentId: "agent-a",
  url: "https://receiver.test/hook",
  events: ["issue.created"],
  signingSecretEncrypted: "cipher",
};

beforeEach(() => {
  vi.resetAllMocks();
  db.webhookSubscription.count.mockResolvedValue(0);
  db.webhookSubscription.findFirst.mockResolvedValue(null);
  db.webhookSubscription.create.mockResolvedValue({
    id: "sub-a",
    url: input.url,
    enabled: true,
    createdAt: new Date(0),
    events: input.events,
  });
});

describe("webhook subscription limits (#512)", () => {
  it("refuses the fourth subscription for one agent", async () => {
    db.webhookSubscription.count.mockResolvedValue(MAX_SUBSCRIPTIONS_PER_AGENT);
    const result = await createSubscriptionRecord(db as never, input);
    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.error).toContain("at most 3");
    expect(db.webhookSubscription.create).not.toHaveBeenCalled();
  });

  it("refuses the same URL twice for one agent", async () => {
    db.webhookSubscription.findFirst.mockResolvedValue({ id: "sub-a" });
    const result = await createSubscriptionRecord(db as never, input);
    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.error).toContain("already subscribed");
    expect(db.webhookSubscription.create).not.toHaveBeenCalled();
  });

  it("enforces cap and duplicate rejection when concurrent creates fire (#498)", async () => {
    let count = 2;
    const urls = new Set<string>();
    let lock = Promise.resolve();
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const run = lock.then(async () => {
        return fn({
          ...db,
          webhookSubscription: {
            count: vi.fn(async () => count),
            findFirst: vi.fn(async ({ where }: { where: { url: string } }) =>
              urls.has(where.url) ? { id: "existing" } : null,
            ),
            create: vi.fn(async ({ data }: { data: { url: string } }) => {
              if (urls.has(data.url)) throw { code: "P2002" };
              urls.add(data.url);
              count++;
              return { id: `sub-${count}`, url: data.url, enabled: true, createdAt: new Date(), events: [] };
            }),
          },
        });
      });
      lock = run.then(() => {}, () => {});
      return run;
    });

    const [first, second, third] = await Promise.all([
      createSubscriptionRecord(db as never, { ...input, url: "https://a.test" }),
      createSubscriptionRecord(db as never, { ...input, url: "https://b.test" }),
      createSubscriptionRecord(db as never, { ...input, url: "https://a.test" }),
    ]);

    const successes = [first, second, third].filter((r) => r.ok);
    const failures = [first, second, third].filter((r) => !r.ok);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

describe("checkSsrf", () => {
  // Helper: override DNS resolution for tests.
  const resolve = (addr: string) => async () => [addr];

  it("rejects non-HTTPS URLs", async () => {
    const result = await checkSsrf("http://example.com/webhook", resolve("93.184.216.34"));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/HTTPS/);
  });

  it("allows a valid external HTTPS URL", async () => {
    const result = await checkSsrf("https://example.com/webhook", resolve("93.184.216.34"));
    expect(result.ok).toBe(true);
  });

  // --- Private/reserved address blocks that must be blocked ---

  it.each([
    ["loopback IPv4", "127.0.0.1"],
    ["loopback IPv4 variant", "127.0.0.2"],
    ["private 10.x", "10.0.0.1"],
    ["private 172.16.x", "172.16.0.1"],
    ["private 172.31.x", "172.31.255.255"],
    ["private 192.168.x", "192.168.1.1"],
    ["link-local", "169.254.0.1"],
    ["cloud metadata", "169.254.169.254"],
    ["all-zeros network", "0.0.0.1"],
    ["shared address space", "100.64.0.1"],
  ])("blocks %s (%s)", async (_label, addr) => {
    const result = await checkSsrf("https://internal/webhook", resolve(addr));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/blocked address/i);
  });

  it("blocks IPv6 loopback", async () => {
    const result = await checkSsrf("https://internal/webhook", async () => ["::1"]);
    expect(result.ok).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 private", async () => {
    // ::ffff:10.0.0.1 maps to 10.0.0.1 which is private.
    const result = await checkSsrf("https://internal/webhook", async () => ["::ffff:10.0.0.1"]);
    expect(result.ok).toBe(false);
  });

  it("checks IP literals without DNS and rejects mixed public/private answers", async () => {
    expect((await checkSsrf("https://[::ffff:127.0.0.1]/")).ok).toBe(false);
    expect((await checkSsrf("https://2130706433/")).ok).toBe(false);
    expect((await checkSsrf("https://endpoint.test", async () => ["93.184.216.34", "10.0.0.1"])).ok).toBe(false);
    expect((await checkSsrf("https://endpoint.test", async () => ["2606:4700:4700::1111"])).ok).toBe(true);
  });

  it("returns ok=false when DNS resolution fails", async () => {
    const result = await checkSsrf("https://nonexistent.invalid/webhook", async () => {
      throw new Error("NXDOMAIN");
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/resolve/i);
  });

});
