import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Connect my agent (#earn-connect): behind the proxy the request's own address is the server's internal one
 * (localhost), so /earn/start must redirect with a path, never an address built from the request.
 */
const findFirst = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { agent: { findFirst: (...args: unknown[]) => findFirst(...args) } } }));
vi.mock("@/lib/earn/earner", () => ({
  earnAgentWhere: (userId: string) => ({ ownerUserId: userId }),
  joinEarnWorkspace: async () => ({ tenantId: "tenant-earn", projectId: "project-earn" }),
}));
vi.mock("@/lib/tenants", () => ({ setActiveTenantCookie: vi.fn(async () => undefined) }));

import { GET } from "@/app/(app)/earn/start/route";

describe("GET /earn/start", () => {
  beforeEach(() => findFirst.mockReset());

  it("sends someone with no Earn agent to the connect page by path", async () => {
    findFirst.mockResolvedValue(null);
    await expect(GET()).rejects.toThrow("REDIRECT:/earn/agent");
  });

  it("sends someone whose agent is connected on to the default page, /earn/home, by path", async () => {
    findFirst.mockResolvedValue({ id: "agent-1" });
    await expect(GET()).rejects.toThrow("REDIRECT:/earn/home");
  });
});
