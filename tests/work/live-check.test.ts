import { describe, expect, it } from "vitest";
import { liveCheck, liveConfirmLabel, liveFactLabel, liveNextStep, liveStepState } from "@/lib/live-check";

// #live-check: a Live issue's fix is where the latest independent pull request check says it is.
const repo = { owner: "zeduchat", repo: "zedu-fe" };
const url = "https://github.com/zeduchat/zedu-fe/pull/119";
const report = (state: "open" | "closed" | "merged" | "not_found", extra: { mergedInto?: string; inDefaultBranch?: boolean } = {}) => ({
  pullRequestUrl: url,
  state,
  mergedInto: extra.mergedInto ?? null,
  inDefaultBranch: extra.inDefaultBranch ?? null,
  agent: { name: "Kofi's agent" },
});

describe("liveCheck", () => {
  it("is released once the default branch has the merge, and ticked once three agents found it on prod", () => {
    const check = liveCheck(url, report("merged", { mergedInto: "main", inDefaultBranch: true }), repo, ["Ada's agent"]);
    expect(check).toMatchObject({ fact: "released", branch: "main", checkedBy: "Kofi's agent", confirmedBy: ["Ada's agent"] });
    expect(liveFactLabel(check)).toBe("In main");
    expect(liveConfirmLabel(check)).toBe("1 of 3 confirmed");
    expect(liveStepState(check)).toBe("now");
    expect(liveNextStep(check, repo)).toMatchObject({ title: "Live: in main, 1 of 3 confirmed on prod", actor: "Other agents" });
    const confirmed = liveCheck(url, report("merged", { mergedInto: "main", inDefaultBranch: true }), repo, ["Ada's agent", "Ben's agent", "Chi's agent"]);
    expect(liveStepState(confirmed)).toBe("done");
    expect(liveNextStep(confirmed, repo)).toMatchObject({ action: null });
  });

  it("is not released while only another branch has it", () => {
    const check = liveCheck(url, report("merged", { mergedInto: "staging", inDefaultBranch: false }), repo);
    expect(check.fact).toBe("not_released");
    expect(liveFactLabel(check)).toBe("Only in staging");
    expect(liveStepState(check)).toBe("now");
  });

  it("says when the pull request was never merged", () => {
    expect(liveCheck(url, report("open"), repo).fact).toBe("pr_open");
    expect(liveCheck(url, report("closed"), repo).fact).toBe("pr_closed");
    expect(liveCheck(url, report("not_found"), repo).fact).toBe("pr_missing");
    expect(liveStepState(liveCheck(url, report("open"), repo))).toBe("warn");
  });

  it("says when there is no pull request, or it is in a team's copy", () => {
    expect(liveCheck(null, null, repo).fact).toBe("no_pr");
    const copy = liveCheck("https://github.com/Cybertron-HNG/zedu-fe/pull/119", null, repo);
    expect(copy).toMatchObject({ fact: "other_repository", repo: "Cybertron-HNG/zedu-fe" });
  });

  it("is unchecked with no report, or a report on another pull request", () => {
    expect(liveCheck(url, null, repo).fact).toBe("unchecked");
    expect(liveCheck(url, { ...report("merged", { inDefaultBranch: true }), pullRequestUrl: `${url}0` }, repo).fact).toBe("unchecked");
  });
});
