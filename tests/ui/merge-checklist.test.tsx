// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MergeChecklistCard, MANUAL_CHECKS } from "@/components/merge-checklist";
import type { MergeChecklist } from "@/lib/merge-checklist";

const MOCK_CHECKLIST: MergeChecklist = {
  items: [
    { key: "repository", label: "Pull request is in the project's repository", state: "pass", detail: null },
    { key: "open", label: "Open on GitHub", state: "pass", detail: null },
    { key: "head", label: "Checked on the delivered commit", state: "pass", detail: null },
    { key: "checks", label: "All checks green", state: "pass", detail: null },
    { key: "conflicts", label: "No merge conflicts", state: "pass", detail: null },
    { key: "fresh", label: "Checked in the last 6 hours", state: "pass", detail: null },
  ],
  passed: 6,
  total: 6,
  verdict: "ready",
  headline: "Ready for a good-to-merge judgement.",
  reportedAt: new Date("2026-11-06T10:00:00Z"),
};

afterEach(cleanup);

describe("MergeChecklistCard (#merge-checklist)", () => {
  it("renders the heading and check count correctly", () => {
    render(<MergeChecklistCard checklist={MOCK_CHECKLIST} />);
    expect(screen.getByRole("heading", { name: /ready-to-merge checklist/i })).toBeDefined();
    expect(screen.getByText("6 / 6")).toBeDefined();
  });

  it("displays the one-line verdict headline", () => {
    render(<MergeChecklistCard checklist={MOCK_CHECKLIST} />);
    expect(screen.getByTestId("merge-checklist-headline").textContent).toBe("Ready for a good-to-merge judgement.");
  });

  it("lists all manual tester checks", () => {
    render(<MergeChecklistCard checklist={MOCK_CHECKLIST} />);
    for (const check of MANUAL_CHECKS) {
      expect(screen.getByText(check)).toBeDefined();
    }
  });

  it("updates progress bar attributes matching passed items", () => {
    render(<MergeChecklistCard checklist={{ ...MOCK_CHECKLIST, passed: 4 }} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    expect(bar.getAttribute("aria-valuemax")).toBe("6");
  });
});
