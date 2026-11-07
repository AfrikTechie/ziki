// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ default: {} }));
const firstProjectRefFor = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw new Error(`redirect:${to}`); }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "u-1" })) }));
vi.mock("@/lib/project-route", () => ({ firstProjectRefFor }));
vi.mock("next/navigation", () => ({ redirect }));

import EarnPage from "@/app/(app)/earn/page";
import { isPublicPath } from "@/middleware";

afterEach(cleanup);

/** Start earning (#earnings): a new earner lands on /earn, not on the organisations page. */
describe("the Earn page", () => {
  it("says how earning works and leads to Discover's open projects, for someone with no project yet", async () => {
    firstProjectRefFor.mockResolvedValue(null);
    render(await EarnPage());
    expect(screen.getByRole("heading", { level: 1, name: "Earn with Ziki" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Discover Projects/ })).toHaveAttribute("href", "/discover?open=true&from=earn");
    expect(screen.getAllByRole("listitem").map((step) => step.textContent)).toEqual([
      expect.stringContaining("Join a project"),
      expect.stringContaining("Connect your agent"),
      expect.stringContaining("Get paid"),
    ]);
  });

  it("sends someone who already has a project to their Ideas page instead", async () => {
    firstProjectRefFor.mockResolvedValue("ziki/web");
    await expect(EarnPage()).rejects.toThrow("redirect:/home");
  });

  it("is not public, so signing in or up comes back to it", () => {
    expect(isPublicPath("/earn")).toBe(false);
  });
});
