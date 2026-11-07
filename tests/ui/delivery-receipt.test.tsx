// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveriesPanel, DeliveryReceiptCard, type DeliveryView } from "@/components/issue-review-entries";

vi.mock("@/app/actions/issues", () => ({ addCommentAction: vi.fn() }));

/** The delivery receipt on the issue page (#delivery-receipt): verified, not verified and reviewer steps under the delivery. */
const receipt = {
  verified: [{ check: "node --test (3/3)", how: "ran on f46960b" }, { check: "prettier clean" }],
  notVerified: [{ check: "Manual race in a real browser", why: "no preview deployment" }],
  reviewerShould: ["Open the preview, search two names"],
};

function delivery(overrides: Partial<DeliveryView> = {}): DeliveryView {
  return {
    id: "d1",
    agentName: "senior-man-triager",
    by: "Bayode",
    summary: "Fixed the stale member search.",
    description: "A generation counter drops stale responses; a regression test pins it.",
    pullRequestUrl: "https://github.com/zeduchat/zedu-fe/pull/1448",
    headSha: "f46960b",
    current: true,
    updatedAt: new Date("2026-11-07T09:00:00Z"),
    replies: [],
    screenshots: [],
    testResults: "node --test: 3 passed",
    receipt,
    ...overrides,
  };
}

afterEach(cleanup);

describe("DeliveryReceiptCard", () => {
  it("shows each list with its rows, the how and why notes, and the summary line", () => {
    render(<DeliveryReceiptCard receipt={receipt} />);
    const card = screen.getByTestId("delivery-receipt");
    expect(card).toHaveAccessibleName("Delivery receipt");
    expect(within(card).getByText("2 verified · 1 not verified · 1 step to test")).toBeInTheDocument();
    const verified = within(card).getByTestId("delivery-receipt-verified");
    expect(within(verified).getAllByRole("listitem")).toHaveLength(2);
    expect(within(verified).getByText("node --test (3/3)")).toBeInTheDocument();
    expect(within(verified).getByText("· ran on f46960b")).toBeInTheDocument();
    const notVerified = within(card).getByTestId("delivery-receipt-not-verified");
    expect(within(notVerified).getByText("Manual race in a real browser")).toBeInTheDocument();
    expect(within(notVerified).getByText("· no preview deployment")).toBeInTheDocument();
    expect(within(within(card).getByTestId("delivery-receipt-reviewer-should")).getByText("Open the preview, search two names")).toBeInTheDocument();
  });

  it("leaves out a list with no rows", () => {
    render(<DeliveryReceiptCard receipt={{ verified: [{ check: "pnpm test" }], notVerified: [], reviewerShould: [] }} />);
    expect(screen.getByTestId("delivery-receipt-verified")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-receipt-not-verified")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delivery-receipt-reviewer-should")).not.toBeInTheDocument();
  });
});

describe("DeliveriesPanel", () => {
  it("shows the receipt under the delivery that carries one, and nothing for one without", () => {
    render(<DeliveriesPanel bugId="bug1" deliveries={[delivery(), delivery({ id: "d0", current: false, receipt: null })]} canReply={false} />);
    const cards = screen.getAllByTestId("delivery-state");
    expect(cards).toHaveLength(2);
    const [current, earlier] = screen.getAllByRole("listitem").filter((item) => item.id.startsWith("delivery-"));
    expect(within(current).getByTestId("delivery-receipt")).toBeInTheDocument();
    expect(within(earlier).queryByTestId("delivery-receipt")).not.toBeInTheDocument();
  });
});
