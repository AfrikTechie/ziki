// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/expedite", () => ({
  expediteBugAction: vi.fn().mockResolvedValue({ success: true, quotaRemaining: 1, isExpedited: true }),
  cancelExpediteBugAction: vi.fn().mockResolvedValue({ success: true, quotaRemaining: 2, isExpedited: false }),
}));

import { SpeedButton } from "./speed-button";

describe("SpeedButton", () => {
  beforeEach(() => cleanup());

  it("renders the Speed Up button with quota badge", () => {
    render(
      <SpeedButton
        bugId="bug-1"
        issueNumber={1042}
        issueTitle="Test Issue"
        remainingQuota={2}
      />
    );

    const btn = screen.getByRole("button", { name: /Speed Up/i });
    expect(btn).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("opens the SpeedRequestModal when clicked", async () => {
    const user = userEvent.setup();
    render(
      <SpeedButton
        bugId="bug-1"
        issueNumber={1042}
        issueTitle="Test Issue"
        remainingQuota={2}
      />
    );

    await user.click(screen.getByRole("button", { name: /Speed Up/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Speed Up #1042/i)).toBeInTheDocument();
    expect(screen.getByText(/Human Urgency Quota/i)).toBeInTheDocument();
    expect(screen.getByText(/Triage & Readiness Vote/i)).toBeInTheDocument();
  });

  it("renders expedited state when initially expedited", () => {
    render(
      <SpeedButton
        bugId="bug-1"
        issueNumber={1042}
        issueTitle="Test Issue"
        isExpedited={true}
      />
    );

    expect(screen.getByText(/EXPEDITED/i)).toBeInTheDocument();
    expect(screen.getByText(/Blocking Queue/i)).toBeInTheDocument();
  });
});
