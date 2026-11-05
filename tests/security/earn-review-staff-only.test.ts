import { beforeEach, describe, expect, it, vi } from "vitest";

/** Only site staff confirm or send back an earn task (#earn-tasks): confirming pays money. */
const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  confirmTask: vi.fn(async () => ({ ok: true })),
  rejectTask: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth-helpers", () => ({ requireSuperAdmin: mocks.requireSuperAdmin }));
vi.mock("@/lib/earn/progress", () => ({ confirmTask: mocks.confirmTask, rejectTask: mocks.rejectTask }));

import { confirmEarnTaskAction, rejectEarnTaskAction } from "@/app/(app)/superadmin/earn/actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("earn review is staff only", () => {
  beforeEach(() => {
    mocks.confirmTask.mockClear();
    mocks.rejectTask.mockClear();
  });

  it("pays and sends back nothing for anyone who is not a super admin", async () => {
    mocks.requireSuperAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(confirmEarnTaskAction({}, form({ userId: "u1", taskKey: "who" }))).rejects.toThrow("NEXT_REDIRECT");
    await expect(rejectEarnTaskAction({}, form({ userId: "u1", taskKey: "who", reason: "no" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.confirmTask).not.toHaveBeenCalled();
    expect(mocks.rejectTask).not.toHaveBeenCalled();
  });

  it("records the staff member who decided", async () => {
    mocks.requireSuperAdmin.mockResolvedValue({ id: "staff-1" });
    await confirmEarnTaskAction({}, form({ userId: "u1", taskKey: "who" }));
    expect(mocks.confirmTask).toHaveBeenCalledWith({}, expect.objectContaining({ userId: "u1", taskKey: "who", staffId: "staff-1" }));
  });
});
