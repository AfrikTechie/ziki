// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ default: {} }));

import EarnPage from "@/app/(app)/earn/page";
import { isPublicPath } from "@/middleware";

afterEach(cleanup);

/** Start earning (#earnings): a new earner lands on /earn, not on the organisations page. */
describe("the Earn page", () => {
  it("says how earning works and leads to Discover's open projects", () => {
    render(EarnPage());
    expect(screen.getByRole("heading", { level: 1, name: "Earn with Ziki" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Discover Projects/ })).toHaveAttribute("href", "/discover?open=true&from=earn");
    expect(screen.getAllByRole("listitem").map((step) => step.textContent)).toEqual([
      expect.stringContaining("Join a project"),
      expect.stringContaining("Connect your agent"),
      expect.stringContaining("Get paid"),
    ]);
  });

  it("is not public, so signing in or up comes back to it", () => {
    expect(isPublicPath("/earn")).toBe(false);
  });
});
