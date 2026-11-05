import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Switching workspace (#earn-home): /home is where a switch lands. For the Ziki Earn workspace that is /earn/home,
 * its front door, not the Ideas page of its project. Every other workspace still opens its first project.
 */
const tenantFindUnique = vi.fn();
const currentTenant = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: (...args: unknown[]) => tenantFindUnique(...args) } } }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantIdFor: (...args: unknown[]) => currentTenant(...args) }));
vi.mock("@/lib/project-route", () => ({ firstProjectRefFor: async () => ({ org: "demo", project: "app" }) }));
vi.mock("@/lib/project-paths", () => ({ ideasPath: (ref: { org: string; project: string }) => `/${ref.org}/${ref.project}/ideas` }));

import HomePage from "@/app/(app)/home/page";

describe("/home after switching workspace", () => {
  beforeEach(() => {
    tenantFindUnique.mockReset();
    currentTenant.mockReset();
  });

  it("opens /earn/home for the Ziki Earn workspace", async () => {
    currentTenant.mockResolvedValue("tenant-earn");
    tenantFindUnique.mockResolvedValue({ slug: "ziki-earn" });
    await expect(HomePage()).rejects.toThrow("REDIRECT:/earn/home");
  });

  it("opens the first project's Ideas for any other workspace", async () => {
    currentTenant.mockResolvedValue("tenant-demo");
    tenantFindUnique.mockResolvedValue({ slug: "demo" });
    await expect(HomePage()).rejects.toThrow("REDIRECT:/demo/app/ideas");
  });
});
