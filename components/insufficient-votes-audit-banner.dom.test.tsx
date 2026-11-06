// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsufficientVotesAuditBanner } from "./insufficient-votes-audit-banner";

describe("InsufficientVotesAuditBanner", () => {
  beforeEach(() => cleanup());

  it("renders the audit warning and votes progress in Ziki design style", () => {
    render(
      <InsufficientVotesAuditBanner
        voteCount={2}
        threshold={3}
        stalledHours={34}
      />
    );

    expect(screen.getByText(/Triage Bottleneck: Insufficient Votes/i)).toBeInTheDocument();
    expect(screen.getByText(/2\/3 votes reached/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request Triage Audit/i })).toBeInTheDocument();
  });

  it("toggles triage rules details on click", async () => {
    const user = userEvent.setup();
    render(<InsufficientVotesAuditBanner voteCount={1} threshold={3} />);

    expect(screen.queryByText(/Ziki Triage Policy/i)).not.toBeInTheDocument();

    const toggleButton = screen.getByRole("button", { name: /View triage rules/i });
    await user.click(toggleButton);

    expect(screen.getByText(/Ziki Triage Policy/i)).toBeInTheDocument();
  });
});
