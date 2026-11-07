import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { beingChecked, headerEarnings, parseWeeklyGoal, totalEarned, weeklyGoalState } from "@/lib/earnings";

/** Earnings (#earnings): the header's $ and the Earnings page read the ledger across every organisation. */
describe("earnings across every project (#earnings)", () => {
  it("adds up every ledger row in every organisation, corrections included", async () => {
    const aggregate = vi.fn(async ({ where }: { where: { userId: string } }) => ({ _sum: { points: where.userId === "earner" ? 7.4 : 0 } }));
    expect(await totalEarned({ pointEntry: { aggregate } } as never, "earner")).toBe(7.4);
    // No organisation filter: money from every project counts.
    expect(aggregate).toHaveBeenCalledWith({ where: { userId: "earner" }, _sum: { points: true } });
  });

  it("counts as being checked only this person's awards still held on live work", async () => {
    const findMany = vi.fn(async () => [
      { heldPayout: [{ userId: "earner", points: 2 }, { userId: "someone-else", points: 5 }] },
      { heldPayout: [{ userId: "earner", points: 1.5 }] },
      { heldPayout: null },
    ]);
    expect(await beingChecked({ bug: { findMany } } as never, "earner")).toBe(3.5);
  });
});

/** Your own weekly goal (#earnings): what is left, what that needs per day, and only real amounts accepted. */
describe("weekly earnings goal (#earnings)", () => {
  it("works out what is left and what that needs per day for the days left", () => {
    // Thursday: Thursday to Sunday is 4 days left.
    const state = weeklyGoalState(20, 100, new Date("2026-11-05T10:00:00Z"));
    expect(state).toMatchObject({ left: 80, daysLeft: 4, perDay: 20, reached: false });
  });

  it("accepts a positive dollar amount and refuses anything else", () => {
    expect(parseWeeklyGoal("1,000")).toBe(1000);
    expect(parseWeeklyGoal("$75.50")).toBe(75.5);
    for (const bad of ["0", "-5", "abc", "1.234", "", null]) expect(parseWeeklyGoal(bad)).toBeNull();
  });
});

/** The header's $ and Withdraw (#earnings): for people who work on projects, not for those who only post them. */
describe("who sees $ and Withdraw in the header (#earnings)", () => {
  const db = (entry: boolean, joined: boolean) => ({
    pointEntry: { findFirst: vi.fn(async () => (entry ? { id: "e" } : null)), aggregate: vi.fn(async () => ({ _sum: { points: 4.5 } })) },
    projectMembership: { findFirst: vi.fn(async () => (joined ? { id: "m" } : null)) },
  }) as never;

  it("counts only payments for work: posting ideas, votes and the sign-up bonus don't show it", async () => {
    const d = db(false, false) as unknown as { pointEntry: { findFirst: ReturnType<typeof vi.fn> } };
    await headerEarnings(d as never, "poster");
    const where = d.pointEntry.findFirst.mock.calls[0][0].where;
    expect(where.role.in).toEqual(expect.arrayContaining(["solver", "reviewer"]));
    for (const posting of ["reporter", "idea", "comment", "vote", "signup"]) expect(where.role.in).not.toContain(posting);
  });

  it("hides it from someone who has never earned and never joined a project", async () => {
    expect(await headerEarnings(db(false, false), "poster")).toBeNull();
  });

  it("shows $0 to someone who just joined a project, and their total once they earn", async () => {
    expect(await headerEarnings(db(false, true), "joiner")).toBe(0);
    expect(await headerEarnings(db(true, true), "earner")).toBe(4.5);
  });
});

/** Per workspace (#earnings, Chloe's call): the header shows what you earned where you are. */
describe("earnings in one workspace (#earnings)", () => {
  it("adds up only that workspace's rows when one is given, and every row when not", async () => {
    const aggregate = vi.fn(async () => ({ _sum: { points: 2 } }));
    await totalEarned({ pointEntry: { aggregate } } as never, "earner", "org-ziki");
    expect(aggregate).toHaveBeenLastCalledWith({ where: { userId: "earner", organisationId: "org-ziki" }, _sum: { points: true } });
    await totalEarned({ pointEntry: { aggregate } } as never, "earner");
    expect(aggregate).toHaveBeenLastCalledWith({ where: { userId: "earner" }, _sum: { points: true } });
  });
});
