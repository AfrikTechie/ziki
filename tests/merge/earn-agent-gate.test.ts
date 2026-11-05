import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Earn (#earn-home): Marketing and Open source are for someone whose agent is connected. Anyone else goes
 * back to /earn/agent, where connecting is, and cannot start a task until it is done.
 */
const findFirst = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { agent: { findFirst: (...args: unknown[]) => findFirst(...args) } } }));

import { EARN_WORKSPACE_SLUG } from "@/lib/earn/draft";
import { requireEarnAgent } from "@/lib/earn/state";

describe("requireEarnAgent", () => {
  beforeEach(() => findFirst.mockReset());

  it("sends someone with no connected agent back to /earn/agent", async () => {
    findFirst.mockResolvedValue(null);
    await expect(requireEarnAgent("user-1")).rejects.toThrow("REDIRECT:/earn/agent");
  });

  it("only counts an agent in the Earn workspace that has not been revoked", async () => {
    findFirst.mockResolvedValue(null);
    await requireEarnAgent("user-1").catch(() => undefined);
    // Agents in the person's other workspaces are not Earn agents: Earn is a place of its own.
    expect(findFirst).toHaveBeenCalledWith({
      where: { ownerUserId: "user-1", revokedAt: null, tenant: { slug: EARN_WORKSPACE_SLUG } },
      select: { id: true },
    });
  });

  it("lets someone with a connected agent through", async () => {
    findFirst.mockResolvedValue({ id: "agent-1" });
    await expect(requireEarnAgent("user-1")).resolves.toBeUndefined();
  });
});
