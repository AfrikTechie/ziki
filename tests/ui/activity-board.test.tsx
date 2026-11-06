// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityClaim, ActivityData } from "@/lib/activity/board";

/** The Activity page's board (#849): what needs you first, live countdowns, Nudge, "Show more" and the agent filter. */

const nudgeAgentAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/activity/actions", () => ({ nudgeAgentAction }));

import { ActivityBoard } from "@/app/(app)/activity/activity-board";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();
const zeddi = { id: "agent-zeddi", name: "Zeddi" };
const zoint = { id: "agent-zoint", name: "Zoint" };

function claim(id: string, number: number, overrides: Partial<ActivityClaim> = {}): ActivityClaim {
  return {
    id,
    status: "active",
    agent: zeddi,
    issue: { id: `bug-${number}`, number, title: `Issue ${number}`, status: "in_progress", substatus: "in_progress", pullRequestUrl: null, href: `/zedu/desktop/${number}` },
    offeredAt: at(-60),
    claimedAt: at(-59),
    deliverBy: at(180),
    lastHeartbeatAt: at(-5),
    waitingOnOwnerSince: null,
    releasedAt: null,
    releaseReason: null,
    createdAt: at(-60),
    offerWindowSeconds: 1800,
    deliveryMinutes: 240,
    ...overrides,
  };
}

function renderBoard(data: Partial<ActivityData>) {
  return render(
    <ActivityBoard
      data={{ agents: [zeddi, zoint], claims: [], questions: [], events: [], slots: [], ...data }}
      renderedAt={NOW}
      isAdmin={false}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ActivityBoard", () => {
  it("puts an offer waiting to be accepted first, with its countdown, and sends a nudge", async () => {
    nudgeAgentAction.mockResolvedValue({ ok: true, at: new Date(NOW).toISOString() });
    renderBoard({ claims: [claim("offer-1", 2306, { status: "offered", offeredAt: at(-17), claimedAt: null, deliverBy: null })] });

    const needs = screen.getByRole("region", { name: "Needs you now" });
    expect(within(needs).getByText("Offer waiting")).toBeInTheDocument();
    expect(within(needs).getByText("13:00")).toBeInTheDocument();
    expect(within(needs).getByRole("link", { name: "#2306 Issue 2306" })).toHaveAttribute("href", "/zedu/desktop/2306");

    fireEvent.click(within(needs).getByRole("button", { name: "Nudge Zeddi" }));
    await waitFor(() => expect(nudgeAgentAction).toHaveBeenCalledWith("offer-1"));
    expect(await within(needs).findByRole("status")).toHaveTextContent("Nudge sent");
    expect(await within(needs).findByRole("button", { name: "Nudge again" })).toBeInTheDocument();
  });

  it("shows why a nudge was refused", async () => {
    nudgeAgentAction.mockResolvedValue({ ok: false, error: "That claim has already ended." });
    renderBoard({ claims: [claim("offer-1", 2306, { status: "offered", offeredAt: at(-1), claimedAt: null })] });
    fireEvent.click(screen.getByRole("button", { name: "Nudge Zeddi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That claim has already ended.");
  });

  it("shows work in progress with the time left to deliver", () => {
    renderBoard({ claims: [claim("c1", 2333, { agent: zoint, deliverBy: at(150) })] });
    const progress = screen.getByRole("region", { name: "In progress" });
    expect(within(progress).getByText("2h 30m left")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Needs you now" })).toHaveTextContent("Nothing needs you right now.");
  });

  it("explains why claims ended, shows them by default, and can hide them", () => {
    renderBoard({ claims: [claim("c1", 2309, { status: "released", releasedAt: at(-30), releaseReason: "expired" })] });
    const ended = screen.getByRole("region", { name: "Ended" });
    expect(within(ended).getByText("Zeddi · the offer wasn't accepted in time")).toBeInTheDocument();
    fireEvent.click(within(ended).getByRole("button", { name: "Hide" }));
    expect(within(ended).queryByText("Zeddi · the offer wasn't accepted in time")).not.toBeInTheDocument();
  });

  it("shows 20 rows per section, then Show more", () => {
    const released = Array.from({ length: 23 }, (_, index) =>
      claim(`c${index}`, 100 + index, { status: "released", releasedAt: at(-index - 1), releaseReason: "agent" }),
    );
    renderBoard({ claims: released });
    const ended = screen.getByRole("region", { name: "Ended" });
    expect(within(ended).getAllByRole("article")).toHaveLength(20);
    fireEvent.click(within(ended).getByRole("button", { name: "Show 3 more ended claims" }));
    expect(within(ended).getAllByRole("article")).toHaveLength(23);
  });

  it("opens a delivered issue's history in place", () => {
    const delivered = { status: "done" as const, substatus: "requires_review" as const };
    renderBoard({
      claims: [claim("c1", 254, { issue: { id: "bug-254", number: 254, title: "Home DMs", ...delivered, pullRequestUrl: "https://github.com/o/r/pull/961", href: "/zedu/desktop/254" } })],
    });
    const section = screen.getByRole("region", { name: "Delivered · waiting on review or merge" });
    expect(within(section).getByText("Done · Requires review")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Show 2 events" }));
    expect(within(section).getByText("Accepted")).toBeInTheDocument();
  });

  it("filters every section to one agent", () => {
    renderBoard({ claims: [claim("c1", 1), claim("c2", 2, { agent: zoint })] });
    const progress = screen.getByRole("region", { name: "In progress" });
    expect(within(progress).getAllByRole("article")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Zoint" }));
    expect(screen.getByRole("button", { name: "Zoint" })).toHaveAttribute("aria-pressed", "true");
    expect(within(progress).getAllByRole("article")).toHaveLength(1);
    expect(within(progress).getByText("#2 Issue 2")).toBeInTheDocument();
  });

  it("expands older activity in place instead of leaving the page", () => {
    const events = Array.from({ length: 22 }, (_, index) => ({
      id: `e${index}`, agent: zeddi, action: "issue.delivered", createdAt: at(-index), undone: false, issue: null,
    }));
    renderBoard({ events });
    const recent = screen.getByRole("region", { name: "Recent activity" });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(20);
    fireEvent.click(within(recent).getByRole("button", { name: "Show older activity" }));
    expect(within(recent).getAllByRole("listitem")).toHaveLength(22);
  });
});
