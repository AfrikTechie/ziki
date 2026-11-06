import { beforeEach, describe, expect, it, vi } from "vitest";
const lookup = vi.hoisted(() => ({ first: vi.fn(), many: vi.fn(), scope: vi.fn(), session: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/organisation-viewer", () => ({ viewerBugScope: lookup.scope }));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: lookup.session }));
vi.mock("@/lib/prisma", () => ({ prisma: { bug: { findFirst: lookup.first, findMany: lookup.many } } }));
import { findProjectIssue } from "@/lib/project-issue";
describe("shared issue addresses across workspaces", () => {
  const active = { id: "a-issue", number: 482, isDeleted: false, project: { slug: "app", organisation: { slug: "zedu" } } };

  beforeEach(() => {
    lookup.first.mockReset();
    lookup.many.mockReset();
    lookup.scope.mockReset().mockResolvedValue({ organisationId: "a" });
    lookup.session.mockReset().mockResolvedValue({ userId: "u" });
  });

  it("prioritizes the exact shared issue despite a number collision in the active workspace", async () => {
    lookup.first.mockResolvedValueOnce(active).mockResolvedValueOnce({ id: "b-issue" });
    expect(await findProjectIssue("ziki", "app", 482)).toEqual({ kind: "elsewhere", issueId: "b-issue" });
  });

  it("does not redirect an inaccessible link to an unrelated same-numbered issue", async () => {
    lookup.first.mockResolvedValueOnce(active).mockResolvedValueOnce(null);
    expect(await findProjectIssue("private", "app", 482)).toBeNull();
  });

  it("still resolves an issue moved between projects in the same workspace", async () => {
    lookup.first.mockResolvedValueOnce(active).mockResolvedValueOnce(null);
    expect(await findProjectIssue("zedu", "old-app", 482)).toMatchObject({ kind: "moved", issue: { id: "a-issue" } });
  });

  it("returns the original issue after switching and on refresh or new tabs", async () => {
    const target = { ...active, id: "b-issue", project: { slug: "app", organisation: { slug: "ziki" } } };
    lookup.scope.mockResolvedValue({ organisationId: "b" });
    lookup.first.mockResolvedValue(target);
    expect(await findProjectIssue("ziki", "app", 482)).toMatchObject({ kind: "found", issue: { id: "b-issue" } });
  });

  it("allows direct public or member project access without workspace membership", async () => {
    const target = { ...active, id: "project-issue", project: { slug: "app", organisation: { slug: "ziki" } } };
    lookup.first.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(target);
    expect(await findProjectIssue("ziki", "app", 482)).toMatchObject({ kind: "found", issue: { id: "project-issue" } });
    expect(lookup.first).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({
      isDeleted: false,
      organisation: { archivedAt: null },
      project: expect.objectContaining({ slug: "app", organisation: { slug: "ziki" }, archivedAt: null,
        OR: [{ visibility: "public" }, { memberships: { some: { userId: "u" } } }],
      }),
    }) }));
  });

  it("preserves the deleted-issue Restore page in the active workspace", async () => {
    const deleted = { ...active, isDeleted: true };
    lookup.first.mockImplementation(async ({ where }) => where.organisationId === "a" && where.isDeleted !== false ? deleted : null);
    expect(await findProjectIssue("zedu", "app", 482)).toMatchObject({ kind: "found", issue: { id: "a-issue", isDeleted: true } });
  });
});
