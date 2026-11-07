import { describe, expect, it } from "vitest";
import {
  ISSUE_PRIORITIES,
  compareIssuePriority,
  isIssuePriority,
  normalizeIssuePriority,
  parseIssuePriority,
} from "@/lib/issue-priority";

describe("issue priority", () => {
  it("recognises the four levels", () => {
    for (const p of ISSUE_PRIORITIES) expect(isIssuePriority(p)).toBe(true);
    expect(isIssuePriority("urgent")).toBe(true);
    expect(isIssuePriority("nope")).toBe(false);
    expect(isIssuePriority(null)).toBe(false);
  });

  it("normalises unknown values to medium", () => {
    expect(normalizeIssuePriority("urgent")).toBe("urgent");
    expect(normalizeIssuePriority("bogus")).toBe("medium");
    expect(normalizeIssuePriority(undefined)).toBe("medium");
  });

  it("parses valid/invalid", () => {
    expect(parseIssuePriority("high")).toBe("high");
    expect(parseIssuePriority("nope")).toBeNull();
  });

  it("sorts urgent first", () => {
    const list = ["low", "medium", "high", "urgent"].sort(compareIssuePriority);
    expect(list).toEqual(["urgent", "high", "medium", "low"]);
  });
});
