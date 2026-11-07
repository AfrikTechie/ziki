import { describe, expect, it } from "vitest";
import { blockerGuidance, wouldCreateBlockerCycle } from "@/lib/issue-blockers";

describe("blockerGuidance", () => {
  it("explains that a failed merge prevents dependent work and gives the author a next step", () => {
    expect(blockerGuidance({ status: "merge", substatus: "error" })).toEqual({
      meaning: "Its pull request cannot merge yet, so work that depends on it is still waiting.",
      nextStep: "Open the blocking issue, follow its merge error, and have its author fix the pull request and report its updated state.",
    });
  });

  it("shows that an issue is no longer a blocker after it goes live", () => {
    expect(blockerGuidance({ status: "resolved", substatus: "on_prod" }).meaning).toContain("dependency may already be cleared");
  });

  it("distinguishes unfinished implementation from review", () => {
    const inProgress = blockerGuidance({ status: "in_progress", substatus: "in_progress" });
    const underReview = blockerGuidance({ status: "done", substatus: "requires_review" });
    expect(inProgress.meaning).toContain("still implementing");
    expect(underReview.meaning).toContain("being tested or reviewed");
  });

  it("rejects a dependency that closes a cycle, including a multi-issue cycle", async () => {
    const edges = new Map([["b", ["c"]], ["c", ["a"]]]);
    await expect(wouldCreateBlockerCycle("a", "b", async (ids) => ids.flatMap((id) => edges.get(id) ?? []))).resolves.toBe(true);
    await expect(wouldCreateBlockerCycle("a", "d", async (ids) => ids.flatMap((id) => edges.get(id) ?? []))).resolves.toBe(false);
  });
});
