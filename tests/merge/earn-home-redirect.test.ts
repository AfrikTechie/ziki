import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Switching organisation (#earn-home): /home is where a switch lands. For the Ziki Earn organisation that is /earn/home,
 * its front door, not the Ideas page of its project. Every other organisation still opens its first project.
 */
const organisationFindUnique = vi.fn();
const currentOrganisation = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { organisation: { findUnique: (...args: unknown[]) => organisationFindUnique(...args) } } }));
vi.mock("@/lib/organisation-context", () => ({ currentOrganisationIdFor: (...args: unknown[]) => currentOrganisation(...args) }));
vi.mock("@/lib/project-route", () => ({ firstProjectRefFor: async () => ({ org: "demo", project: "app" }) }));
vi.mock("@/lib/project-paths", () => ({ ideasPath: (ref: { org: string; project: string }) => `/${ref.org}/${ref.project}/ideas` }));

import HomePage from "@/app/(app)/home/page";

describe("/home after switching organisation", () => {
  beforeEach(() => {
    organisationFindUnique.mockReset();
    currentOrganisation.mockReset();
  });

  it("opens /earn/home for the Ziki Earn organisation", async () => {
    currentOrganisation.mockResolvedValue("organisation-earn");
    organisationFindUnique.mockResolvedValue({ slug: "ziki-earn" });
    await expect(HomePage()).rejects.toThrow("REDIRECT:/earn/home");
  });

  it("opens the first project's Ideas for any other organisation", async () => {
    currentOrganisation.mockResolvedValue("organisation-demo");
    organisationFindUnique.mockResolvedValue({ slug: "demo" });
    await expect(HomePage()).rejects.toThrow("REDIRECT:/demo/app/ideas");
  });
});
