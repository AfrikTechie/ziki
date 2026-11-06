import { beforeEach, describe, expect, it, vi } from "vitest";

const publishWebEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/agent-api/web-events", () => ({
  publishWebEvent,
}));

vi.mock("@/lib/organisation-context", () => ({
  currentOrganisationIdFor: vi.fn(async () => "organisation-zedu"),
  bugInOrganisation: vi.fn(() => ({ organisationId: "organisation-zedu" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockRequireUser = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "user-1", name: "Ezekiel", role: "member" })
);
vi.mock("@/lib/auth-helpers", () => ({
  requireUser: mockRequireUser,
}));

const mockPrisma = vi.hoisted(() => ({
  bugActivity: {
    count: vi.fn(),
    create: vi.fn(),
  },
  bug: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(mockPrisma)
  ),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

import {
  expediteBugAction,
  cancelExpediteBugAction,
  getUserDailyExpediteQuota,
} from "./expedite";
import { DAILY_EXPEDITE_QUOTA } from "@/lib/expedite-constants";

describe("expedite actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserDailyExpediteQuota", () => {
    it("returns total quota 3 and remaining 3 when no activity exists", async () => {
      mockPrisma.bugActivity.count.mockResolvedValueOnce(0);

      const quota = await getUserDailyExpediteQuota("user-1");
      expect(quota.total).toBe(DAILY_EXPEDITE_QUOTA);
      expect(quota.used).toBe(0);
      expect(quota.remaining).toBe(3);
    });

    it("calculates remaining quota accurately when user has expedited today", async () => {
      mockPrisma.bugActivity.count.mockResolvedValueOnce(2);

      const quota = await getUserDailyExpediteQuota("user-1");
      expect(quota.used).toBe(2);
      expect(quota.remaining).toBe(1);
    });
  });

  describe("expediteBugAction", () => {
    it("fails when daily quota is exhausted", async () => {
      mockPrisma.bugActivity.count.mockResolvedValueOnce(3);

      const result = await expediteBugAction(
        "bug-1042",
        "triage_vote",
        "Critical blocker"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Daily urgency quota exhausted");
      }
      expect(mockPrisma.bug.update).not.toHaveBeenCalled();
    });

    it("successfully expedites an issue and records blocking activity", async () => {
      mockPrisma.bugActivity.count.mockResolvedValueOnce(1); // 1 used, 2 remaining
      mockPrisma.bug.findUnique.mockResolvedValueOnce({
        id: "bug-1042",
        number: 1042,
        title: "Audit for Insufficient Votes",
        isDeleted: false,
      });

      const result = await expediteBugAction(
        "bug-1042",
        "triage_vote",
        "Needs 3 votes for readiness"
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.isExpedited).toBe(true);
        expect(result.quotaRemaining).toBe(1);
      }

      expect(mockPrisma.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bug-1042" },
          data: expect.objectContaining({ isBoosted: true }),
        })
      );

      expect(mockPrisma.bugActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bugId: "bug-1042",
            actorId: "user-1",
            type: "boosted",
            metadata: expect.objectContaining({
              field: "expedited",
              actionType: "triage_vote",
            }),
          }),
        })
      );

      expect(publishWebEvent).toHaveBeenCalled();
    });
  });

  describe("cancelExpediteBugAction", () => {
    it("removes issue from blocking queue and unboosts it", async () => {
      mockPrisma.bug.findUnique.mockResolvedValueOnce({
        id: "bug-1042",
        number: 1042,
      });
      mockPrisma.bugActivity.count.mockResolvedValueOnce(0);

      const result = await cancelExpediteBugAction("bug-1042");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.isExpedited).toBe(false);
      }

      expect(mockPrisma.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bug-1042" },
          data: expect.objectContaining({ isBoosted: false }),
        })
      );
    });
  });
});
