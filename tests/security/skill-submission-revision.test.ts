import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Revision flow (#skills-library): when a contributor resubmits a rejected
 * skill, the route must persist the revised tags + checklist and move the
 * submission back to "pending" instead of dropping them.
 */

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    skillSubmission: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      update: mocks.update,
      create: mocks.create,
    },
  },
}));
vi.mock("@/lib/session-user", () => ({
  resolveSessionUserId: async () => ({ userId: "user-1" }),
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireSuperAdmin: async () => ({ id: "user-1", role: "super_admin" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({
    allowed: true,
    retryAfterMs: 0,
    remaining: 4,
    resetAfterMs: 0,
  }),
}));

import { POST } from "@/app/api/v1/skills/submissions/route";

const validRevisionBody = {
  title: "Login button broken",
  category: "testing",
  summary: "A skill that reproduces the login bug.",
  tags: ["auth", "repro"],
  prompt: "Reproduce the login failure and report it.",
  checklist: ["unit test added", "docs updated"],
  revisionOfId: "sub-1",
};

describe("POST /api/v1/skills/submissions (revision)", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.findUnique.mockReset();
    mocks.update.mockReset();
    mocks.create.mockReset();
    mocks.findUnique.mockResolvedValue(null);
  });

  it("persists revised tags and checklist and resets status to pending", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "sub-1",
      submittedById: "user-1",
      status: "rejected",
    });
    mocks.update.mockResolvedValue({
      id: "sub-1",
      slug: "login-button-broken",
      title: "Login button broken",
      category: "testing",
      categoryLabel: "Testing & QA",
      summary: "A skill that reproduces the login bug.",
      tags: ["auth", "repro"],
      prompt: "Reproduce the login failure and report it.",
      checklist: ["unit test added", "docs updated"],
      status: "pending",
      submittedById: "user-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const req = new NextRequest("http://localhost/api/v1/skills/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRevisionBody),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const call = mocks.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "sub-1" });
    expect(call.data.tags).toEqual(["auth", "repro"]);
    expect(call.data.checklist).toEqual(["unit test added", "docs updated"]);
    expect(call.data.status).toBe("pending");
    expect(call.data.rejectionReason).toBeNull();
  });

  it("does not revise when the target submission is not rejected", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "sub-2",
      submittedById: "user-1",
      status: "approved",
    });
    mocks.create.mockResolvedValue({
      id: "sub-new",
      slug: "login-button-broken",
      title: "Login button broken",
      category: "testing",
      categoryLabel: "Testing & QA",
      summary: "A skill that reproduces the login bug.",
      tags: ["auth", "repro"],
      prompt: "Reproduce the login failure and report it.",
      checklist: ["unit test added", "docs updated"],
      status: "pending",
      submittedById: "user-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const req = new NextRequest("http://localhost/api/v1/skills/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validRevisionBody, revisionOfId: "sub-2" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // A new submission is created instead of revising; update is not called.
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
