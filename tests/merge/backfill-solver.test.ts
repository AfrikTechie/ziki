import { describe, expect, it } from "vitest";
import { backfillEntries, type HistoricalBug } from "@/lib/points/backfill";

// #656: backfill must use the same solver eligibility as the live and bulk
// award paths — `resolved` only — and duplicates never earn solver points.
// This file sits in the new tests home, since the old lib/points regression
// files were relocated upstream.

const bug = (overrides: Partial<HistoricalBug>): HistoricalBug => ({
  id: "bug-1",
  organisationId: "organisation-zedu",
  status: "resolved",
  assigneeId: "solver-1",
  reporterId: "reporter-1",
  duplicateOfId: null,
  isDeleted: false,
  ...overrides,
});

describe("backfill solver eligibility (#656)", () => {
  it("pays solver and reporter for a resolved, assigned, non-duplicate bug", () => {
    expect(backfillEntries(bug({}))).toMatchObject([
      { role: "solver", userId: "solver-1", sourceKey: "solver:bug-1:solver-1" },
      { role: "reporter", userId: "reporter-1", sourceKey: "reporter:bug-1:reporter-1" },
    ]);
  });

  it("never pays a solver award from a closed status (#656)", () => {
    // The live close paid nothing; backfill must match, since closed can be
    // invalid, cancelled or won't-fix.
    expect(backfillEntries(bug({ status: "closed" })).map((e) => e.role)).toEqual(["reporter"]);
  });

  it("an assigned closed duplicate earns nothing at all (#656)", () => {
    expect(backfillEntries(bug({ status: "closed", duplicateOfId: "bug-0" }))).toEqual([]);
  });

  it("a resolved duplicate pays no solver, and not the reporter either", () => {
    expect(backfillEntries(bug({ duplicateOfId: "bug-0" }))).toEqual([]);
  });

  it("an unfinished assigned bug earns no solver award", () => {
    expect(backfillEntries(bug({ status: "in_progress" })).map((e) => e.role)).toEqual([
      "reporter",
    ]);
  });

  it("a deleted bug earns nothing", () => {
    expect(backfillEntries(bug({ isDeleted: true }))).toEqual([]);
  });

  it("never backfills reporter points to a public intake identity", () => {
    expect(backfillEntries(bug({ idea: { source: "public" } })).map((entry) => entry.role)).toEqual(["solver"]);
  });
});
