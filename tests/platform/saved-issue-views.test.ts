import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), lock: vi.fn(),
}));
const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/project-route", () => ({ requireProject: access }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    savedIssueView: db,
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ savedIssueView: db, $executeRaw: db.lock }),
  },
}));
import { saveIssueViewAction, deleteIssueViewAction } from "@/app/actions/saved-issue-views";
import { savedIssueQuery, savedIssueViewHref, savedIssueViewSchema } from "@/lib/saved-issue-views";
import { projectRef } from "@/lib/project-paths";
beforeEach(() => {
  vi.resetAllMocks();
  access.mockResolvedValue({ user: { id: "person" }, project: { id: "project" } });
  db.findFirst.mockResolvedValue(null);
  db.count.mockResolvedValue(0);
});
describe("saved issue views", () => {
  it("reopens the status and filters on page one through the project's existing route", () => {
    const query = savedIssueQuery("q=login&sort=title&mine=watching&track=marketing&mywork=1&page=9&next=https://elsewhere.test&status=closed");
    expect(query).toBe("q=login&sort=title&mine=watching&mywork=1&track=marketing");
    expect(savedIssueViewHref(projectRef("team", "web"), { status: "in_progress", query }))
      .toBe("/team/web/issues/in-progress?" + query);
  });
  it("rejects missing names, oversized input, and statuses the board does not support", () => {
    expect(savedIssueViewSchema.safeParse({ name: " ", status: "open", query: "" }).success).toBe(false);
    expect(savedIssueViewSchema.safeParse({ name: "Queue", status: "../../admin", query: "" }).success).toBe(false);
    expect(savedIssueViewSchema.safeParse({ name: "Queue", status: "open", query: "x".repeat(4001) }).success).toBe(false);
  });
  it("saves the authenticated person's view in the resolved project", async () => {
    expect(await saveIssueViewAction("team", "web", { name: " My work ", status: "open", query: "page=8&q=login" })).toEqual({ ok: true });
    expect(db.create).toHaveBeenCalledWith({ data: { userId: "person", projectId: "project", name: "My work", status: "open", query: "q=login" } });
  });
  it("refuses duplicate names and full collections without overwriting a view", async () => {
    db.findFirst.mockResolvedValue({ id: "existing" });
    expect(await saveIssueViewAction("team", "web", { name: "Queue", status: "open", query: "" })).toHaveProperty("error");
    db.findFirst.mockResolvedValue(null);
    db.count.mockResolvedValue(20);
    expect(await saveIssueViewAction("team", "web", { name: "Queue", status: "open", query: "" })).toHaveProperty("error");
    expect(db.create).not.toHaveBeenCalled();
  });
  it("never deletes another person's or project's view, and tolerates a repeated delete", async () => {
    db.deleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteIssueViewAction("team", "web", "foreign-view")).toEqual({ ok: true });
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { id: "foreign-view", userId: "person", projectId: "project" } });
  });
  it("propagates project-access rejection before any data is changed", async () => {
    access.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(saveIssueViewAction("other", "private", { name: "Queue", status: "open", query: "" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(deleteIssueViewAction("other", "private", "view")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(db.create).not.toHaveBeenCalled();
    expect(db.deleteMany).not.toHaveBeenCalled();
  });
  it("returns a retryable error when persistence fails", async () => {
    db.create.mockRejectedValue(new Error("Database unavailable"));
    expect(await saveIssueViewAction("team", "web", { name: "Queue", status: "open", query: "" })).toHaveProperty("error");
  });
});
