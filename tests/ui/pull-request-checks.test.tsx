// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * #pr-checks: the issue's Checks card names what failed, says what still needs
 * attention, and never reads an unknown or unreadable check as a pass.
 */
import { PullRequestChecks, pullRequestChecksUrl, type PullRequestChecksReport } from "@/components/pull-request-checks";

afterEach(cleanup);

const PR = "https://github.com/emerjent/ziki/pull/552";

function report(over: Partial<PullRequestChecksReport> = {}): PullRequestChecksReport {
  return {
    state: "open",
    checks: "passing",
    checkRuns: null,
    mergeable: true,
    note: "Looked at the checks tab on GitHub.",
    ageMinutes: 12,
    reportedBy: { agentName: "Erin's Claude", name: "Erin" },
    ...over,
  };
}

const check = (name: string, status: string, over: Record<string, unknown> = {}) => ({ name, status, ...over });

const names = () => screen.getAllByTestId("pr-check-row").map((row) => row.getAttribute("data-status"));

describe("the pull request Checks card (#pr-checks)", () => {
  it("says every check passed, and lists them by name", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({
        checks: "passing",
        checkRuns: [check("TypeScript", "passed"), check("Build", "passed"), check("Code quality", "passed")],
      })}
    />);

    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("All 3 checks passed");
    expect(screen.getByTestId("pr-checks-summary")).toHaveAttribute("data-tone", "ok");
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getAllByText("Passed")).toHaveLength(3);
    expect(names()).toEqual(["passed", "passed", "passed"]);
  });

  it("names the failed checks and counts them in the summary", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({
        checks: "failing",
        checkRuns: [
          check("Prettier", "failed", { url: `${PR}/checks`, summary: "3 files need formatting." }),
          check("ESLint", "failed"),
          check("TypeScript", "passed"),
        ],
      })}
    />);

    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("2 of 3 checks failed");
    expect(screen.getByTestId("pr-checks-summary")).toHaveAttribute("data-tone", "bad");
    expect(screen.getByText("Prettier")).toBeInTheDocument();
    expect(screen.getByText("ESLint")).toBeInTheDocument();
    expect(screen.getAllByText("Failed")).toHaveLength(2);
    // Actionable failure context, when the reporter had any.
    expect(screen.getByText(/3 files need formatting\./)).toBeInTheDocument();
    // A direct way to the failing checks on GitHub.
    expect(screen.getByRole("link", { name: /View failed checks on GitHub/i })).toHaveAttribute("href", `${PR}/checks`);
  });

  it("shows pending checks as running, not as passed", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({ checks: "pending", checkRuns: [check("Build", "passed"), check("Playwright", "pending")] })}
    />);

    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("1 of 2 checks are still running");
    expect(screen.getByTestId("pr-checks-summary")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("All 2 checks passed")).not.toBeInTheDocument();
  });

  it("reads a mixed set as failing, and keeps every state distinct", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({
        checks: "failing",
        checkRuns: [
          check("Lint", "failed"),
          check("Build", "pending"),
          check("TypeScript", "passed"),
          check("E2E", "skipped"),
          check("Perf", "neutral"),
          check("Deploy", "cancelled"),
        ],
      })}
    />);

    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("1 of 6 checks failed, 1 cancelled");
    expect(names()).toEqual(["failed", "pending", "passed", "skipped", "neutral", "cancelled"]);
    for (const label of ["Failed", "Running", "Passed", "Skipped", "Neutral", "Cancelled"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("says when the pull request has no checks configured", () => {
    render(<PullRequestChecks pullRequestUrl={PR} report={report({ checks: "none", checkRuns: null })} />);
    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("No checks are configured on this pull request");
    expect(screen.queryAllByTestId("pr-check-row")).toHaveLength(0);
  });

  it("says when nobody has reported the checks yet, rather than implying they passed", () => {
    render(<PullRequestChecks pullRequestUrl={PR} report={null} />);
    expect(screen.getByTestId("pr-checks-card")).toHaveTextContent("No check status reported yet.");
    expect(screen.queryByTestId("pr-checks-summary")).not.toBeInTheDocument();
    expect(screen.queryByText(/passed/i)).not.toBeInTheDocument();
  });

  it("shows checks the agent could not read as unavailable, never as passed (#permission)", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({ checks: null, checkRuns: [check("Build", "unavailable"), check("E2E", "unavailable")] })}
    />);

    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("Checks can't be read");
    expect(screen.getByTestId("pr-checks-summary")).toHaveAttribute("data-tone", "muted");
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText(/checks passed/i)).not.toBeInTheDocument();
  });

  it("never displays 'All checks passed' when any check is unavailable", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({ checks: "unknown", checkRuns: [check("Build", "passed"), check("E2E", "unavailable")] })}
    />);

    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("1 of 2 checks can't be read");
    expect(screen.getByTestId("pr-checks-summary")).toHaveAttribute("data-tone", "warn");
    expect(screen.queryByText(/All 2 checks passed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/The check passed/i)).not.toBeInTheDocument();
  });

  it("shows a state this build does not know as unavailable", () => {
    render(<PullRequestChecks pullRequestUrl={PR} report={report({ checks: null, checkRuns: [check("Build", "timed_out")] })} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
  });

  it("never shows passing summary when any row has an unrecognized status", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({
        checks: "unknown",
        checkRuns: [check("Build", "passed"), check("E2E", "timed_out")],
      })}
    />);

    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("can't be read");
    expect(screen.queryByText(/All 2 checks passed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/The check passed/i)).not.toBeInTheDocument();
  });

  it("says the pull request is gone when it is a 404", () => {
    render(<PullRequestChecks pullRequestUrl={PR} report={report({ state: "not_found", checks: null })} />);
    expect(screen.getByTestId("pr-checks-card")).toHaveTextContent("isn't on GitHub (404)");
    expect(screen.queryByTestId("pr-checks-summary")).not.toBeInTheDocument();
  });

  it("says the checks could not be loaded instead of claiming a result", () => {
    render(<PullRequestChecks pullRequestUrl={PR} report={null} failed />);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't be loaded");
    expect(screen.getByRole("alert")).toHaveTextContent("not the same as passing");
  });

  it("keeps a merge conflict apart from a failed check", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({ checks: "passing", checkRuns: [check("Build", "passed")], mergeable: false })}
    />);

    expect(screen.getByTestId("pr-checks-summary")).toHaveTextContent("The check passed");
    expect(screen.getByTestId("pr-checks-conflict")).toHaveTextContent("merge conflict, not a failed check");
  });

  it("says green checks are not an accepted fix, and only when checks are green", () => {
    const { rerender } = render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({ checks: "passing", checkRuns: [check("Build", "passed")] })}
    />);
    expect(screen.getByText(/Passing checks don't accept the fix on their own/)).toBeInTheDocument();

    rerender(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({ checks: "failing", checkRuns: [check("Build", "failed")] })}
    />);
    expect(screen.queryByText(/Passing checks don't accept the fix on their own/)).not.toBeInTheDocument();
  });

  it("shows who reported it and how long ago, and flags a stale report", () => {
    const { rerender } = render(<PullRequestChecks pullRequestUrl={PR} report={report({ ageMinutes: 12 })} />);
    expect(screen.getByTestId("pr-checks-provenance")).toHaveTextContent("Reported 12 min ago by Erin's Claude for Erin");
    expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument();

    rerender(<PullRequestChecks pullRequestUrl={PR} report={report({ ageMinutes: 7 * 60 })} />);
    expect(screen.getByTestId("pr-checks-provenance")).toHaveTextContent("Reported 7 h ago");
    expect(screen.getByText(/may be out of date/)).toBeInTheDocument();
  });

  it("credits Ziki's own GitHub read when nobody reported it (#github-status)", () => {
    render(<PullRequestChecks pullRequestUrl={PR} report={report({ reportedBy: null, ageMinutes: 5 })} />);
    expect(screen.getByTestId("pr-checks-provenance")).toHaveTextContent("Read 5 min ago on GitHub by Ziki");
    expect(screen.queryByText(/by Erin's Claude for Erin/)).not.toBeInTheDocument();
  });

  it("offers a refresh when the report has gone stale, with the reason", () => {
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({ ageMinutes: 7 * 60 })}
      refreshHint="The latest report is 7 hours old."
      refreshInstructions="Check the pull request on GitHub and report what you see."
    />);
    expect(screen.getByText("The latest report is 7 hours old.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Instructions for Agent/i })).toBeInTheDocument();
  });

  it("renders long check names in full, with an accessible link and a text status", () => {
    const long = "Structure, Reuse, URLs & Secrets · Code quality and dependency audit across every workspace package";
    render(<PullRequestChecks
      pullRequestUrl={PR}
      report={report({ checks: "failing", checkRuns: [check(long, "failed", { url: `${PR}/checks` })] })}
    />);

    expect(screen.getByText(long)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: new RegExp(long.slice(0, 30)) });
    expect(link).toHaveAttribute("href", `${PR}/checks`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The state is a word on screen, not only a colour.
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("labels the card for assistive technology", () => {
    render(<PullRequestChecks pullRequestUrl={PR} report={report({ checkRuns: [check("Build", "passed")] })} />);
    expect(screen.getByRole("region", { name: "Pull request checks" })).toBeInTheDocument();
  });

  it("builds the GitHub Checks tab link from the pull request URL", () => {
    expect(pullRequestChecksUrl(PR)).toBe(`${PR}/checks`);
    expect(pullRequestChecksUrl(`${PR}/`)).toBe(`${PR}/checks`);
  });
});
