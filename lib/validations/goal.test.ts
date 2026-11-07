import { describe, expect, it } from "vitest";
import { createGoalSchema, splitGoalPoolSchema, updateGoalStatusSchema } from "./goal";

describe("createGoalSchema (#616)", () => {
  it("accepts a minimal goal", () => {
    const parsed = createGoalSchema.parse({ title: "Ship the auth audit", budgetPool: 1000 });
    expect(parsed).toMatchObject({ title: "Ship the auth audit", budgetPool: 1000, description: null });
  });

  it("coerces a numeric string pool and trims the title", () => {
    const parsed = createGoalSchema.parse({ title: "  Ship it  ", budgetPool: "250" });
    expect(parsed.title).toBe("Ship it");
    expect(parsed.budgetPool).toBe(250);
  });

  it("treats an empty description as null", () => {
    expect(createGoalSchema.parse({ title: "Ship it", budgetPool: 1, description: "   " }).description).toBeNull();
  });

  it("accepts a zero-credit pool", () => {
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: 0 }).success).toBe(true);
  });

  it("rejects a short title, negative or fractional pool, and unknown keys", () => {
    expect(createGoalSchema.safeParse({ title: "x", budgetPool: 1 }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: -1 }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: 1.5 }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: 1, extra: true }).success).toBe(false);
  });

  it("rejects non-numeric budgetPool primitives: null, empty string, booleans, arrays, exponential notation (#502)", () => {
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: null }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: "" }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: false }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: true }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: [] }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Ship it", budgetPool: "1e2" }).success).toBe(false);
  });
});

describe("splitGoalPoolSchema (#616)", () => {
  it("accepts a proportional split with weights", () => {
    const parsed = splitGoalPoolSchema.parse({
      method: "proportional",
      amount: 600,
      targets: [
        { targetType: "issue", targetBugId: "bug_1", weight: 3 },
        { targetType: "agent", label: "Audit report", weight: 1 },
      ],
    });
    expect(parsed.method).toBe("proportional");
    expect(parsed.targets).toHaveLength(2);
  });

  it("accepts a manual split with per-target amounts and no top-level amount", () => {
    const parsed = splitGoalPoolSchema.parse({
      method: "manual",
      targets: [
        { targetType: "issue", targetBugId: "bug_1", amount: 100 },
        { targetType: "goal", targetGoalId: "goal_2", amount: 50 },
      ],
    });
    expect(parsed.targets.map((target) => target.amount)).toEqual([100, 50]);
  });

  it("accepts an even split and a milestone split that totals 100", () => {
    expect(
      splitGoalPoolSchema.safeParse({ method: "even", targets: [{ targetType: "issue", targetBugId: "b1" }] }).success,
    ).toBe(true);
    expect(
      splitGoalPoolSchema.safeParse({
        method: "milestone",
        targets: [
          { targetType: "issue", targetBugId: "b1", weight: 60 },
          { targetType: "issue", targetBugId: "b2", weight: 40 },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects a target missing the id its type needs", () => {
    const issue = splitGoalPoolSchema.safeParse({
      method: "even",
      targets: [{ targetType: "issue" }],
    });
    expect(issue.success).toBe(false);
    expect(issue.error?.issues.some((i) => i.path.join(".") === "targets.0.targetBugId")).toBe(true);

    expect(splitGoalPoolSchema.safeParse({ method: "even", targets: [{ targetType: "goal" }] }).success).toBe(false);
    expect(splitGoalPoolSchema.safeParse({ method: "even", targets: [{ targetType: "agent" }] }).success).toBe(false);
  });

  it("rejects an id given for the wrong target type", () => {
    const parsed = splitGoalPoolSchema.safeParse({
      method: "even",
      targets: [{ targetType: "issue", targetBugId: "b1", targetAgentId: "a1" }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((i) => i.path.join(".") === "targets.0.targetAgentId")).toBe(true);
  });

  it("rejects non-numeric amount and weight primitives (#502)", () => {
    for (const invalid of [null, "", false, true, [], "1e2"]) {
      expect(
        splitGoalPoolSchema.safeParse({
          method: "proportional",
          amount: invalid,
          targets: [{ targetType: "issue", targetBugId: "b1", weight: 1 }],
        }).success,
      ).toBe(false);
      expect(
        splitGoalPoolSchema.safeParse({
          method: "proportional",
          targets: [{ targetType: "issue", targetBugId: "b1", weight: invalid }],
        }).success,
      ).toBe(false);
      expect(
        splitGoalPoolSchema.safeParse({
          method: "manual",
          targets: [{ targetType: "issue", targetBugId: "b1", amount: invalid }],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects method/target mismatches", () => {
    // manual wants amounts, not weights.
    expect(
      splitGoalPoolSchema.safeParse({
        method: "manual",
        targets: [{ targetType: "issue", targetBugId: "b1", amount: 10, weight: 1 }],
      }).success,
    ).toBe(false);
    // proportional wants weights, not amounts.
    expect(
      splitGoalPoolSchema.safeParse({
        method: "proportional",
        targets: [{ targetType: "issue", targetBugId: "b1", amount: 10 }],
      }).success,
    ).toBe(false);
    // even computes its own amounts.
    expect(
      splitGoalPoolSchema.safeParse({
        method: "even",
        targets: [{ targetType: "issue", targetBugId: "b1", amount: 10 }],
      }).success,
    ).toBe(false);
    // a manual split carries no top-level amount.
    expect(
      splitGoalPoolSchema.safeParse({
        method: "manual",
        amount: 10,
        targets: [{ targetType: "issue", targetBugId: "b1", amount: 10 }],
      }).success,
    ).toBe(false);
  });

  it("rejects milestone shares that do not total 100", () => {
    const parsed = splitGoalPoolSchema.safeParse({
      method: "milestone",
      targets: [
        { targetType: "issue", targetBugId: "b1", weight: 50 },
        { targetType: "issue", targetBugId: "b2", weight: 40 },
      ],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((i) => i.message.includes("total exactly 100"))).toBe(true);
  });

  it("rejects an empty target list and unknown keys", () => {
    expect(splitGoalPoolSchema.safeParse({ method: "even", targets: [] }).success).toBe(false);
    expect(splitGoalPoolSchema.safeParse({ method: "even", targets: [{ targetType: "issue", targetBugId: "b1" }], extra: 1 }).success).toBe(false);
  });
});

describe("updateGoalStatusSchema (#616)", () => {
  it("accepts each lifecycle value", () => {
    for (const status of ["active", "completed", "cancelled"]) {
      expect(updateGoalStatusSchema.parse({ status })).toEqual({ status });
    }
  });

  it("rejects an unknown status", () => {
    expect(updateGoalStatusSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});
