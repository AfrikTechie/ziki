import { beforeEach, describe, expect, it, vi } from "vitest";

const totalEarned = vi.hoisted(() => vi.fn());
const beingChecked = vi.hoisted(() => vi.fn());
const organisationFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "earner" })) }));
vi.mock("@/lib/earnings", () => ({ totalEarned, beingChecked }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organisation: { findFirst: organisationFindFirst },
    user: { findUnique: vi.fn(async () => ({ walletAddress: null })) },
  },
}));

import { withdrawDetailsAction } from "@/app/(app)/earnings/withdraw-actions";

/** The Withdraw window (#earnings) shows the same money as the header's $. */
describe("Withdraw details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    totalEarned.mockResolvedValue(0.67);
    beingChecked.mockResolvedValue(0);
  });

  it("counts all your money when you're in no workspace (you only joined projects), as the header does", async () => {
    const details = await withdrawDetailsAction(null);
    expect(details.available).toBe(0.67);
    expect(totalEarned).toHaveBeenCalledWith(expect.anything(), "earner");
    expect(organisationFindFirst).not.toHaveBeenCalled();
  });

  it("counts only the workspace you're in when there is one", async () => {
    organisationFindFirst.mockResolvedValue({ id: "org-ziki", name: "Ziki", slug: "ziki" });
    const details = await withdrawDetailsAction("org-ziki");
    expect(details).toMatchObject({ available: 0.67, workspace: "Ziki" });
    expect(totalEarned).toHaveBeenCalledWith(expect.anything(), "earner", "org-ziki");
  });

  it("shows nothing for a workspace that isn't yours", async () => {
    organisationFindFirst.mockResolvedValue(null);
    const details = await withdrawDetailsAction("someone-elses");
    expect(details.available).toBe(0);
    expect(totalEarned).not.toHaveBeenCalled();
  });
});
