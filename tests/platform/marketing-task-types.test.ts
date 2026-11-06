import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Marketing task types (M-API-7): the lib the agent routes and the Marketing
 * settings page share. Only marketing-track types are read or changed, names
 * are unique in the organisation across tracks, there are no points (D5), and a
 * type a task or proposal uses can't be deleted.
 */
const typeFindFirst = vi.hoisted(() => vi.fn());
const typeFindMany = vi.hoisted(() => vi.fn());
const typeCreate = vi.hoisted(() => vi.fn());
const typeUpdate = vi.hoisted(() => vi.fn());
const typeDelete = vi.hoisted(() => vi.fn());
const bugCount = vi.hoisted(() => vi.fn());
const bugFindMany = vi.hoisted(() => vi.fn());
const ideaCount = vi.hoisted(() => vi.fn());
const activityCreateMany = vi.hoisted(() => vi.fn());
const projectFindFirst = vi.hoisted(() => vi.fn());
const updateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    issueType: { update: typeUpdate },
    bug: { findMany: bugFindMany },
    bugActivity: { createMany: activityCreateMany },
  };
  return {
    prisma: {
      project: { findFirst: projectFindFirst },
      issueType: { findFirst: typeFindFirst, findMany: typeFindMany, create: typeCreate, update: typeUpdate, delete: typeDelete },
      bug: { count: bugCount },
      idea: { count: ideaCount },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
  };
});

import {
  createMarketingTaskType,
  deleteMarketingTaskType,
  getMarketingTaskType,
  listMarketingTaskTypes,
  marketingTaskTypeProject,
  toggleMarketingTaskTypeActive,
  updateMarketingTaskType,
} from "@/lib/marketing/task-types";

const blog = {
  id: "type-1",
  name: "Blog post",
  description: null,
  isActive: true,
  track: "marketing",
  createdAt: new Date("2026-11-05T09:00:00Z"),
  updatedAt: new Date("2026-11-05T09:00:00Z"),
};

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { status: number; message: string; body?: Record<string, unknown> };
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.clearAllMocks();
  typeFindFirst.mockResolvedValue(null);
  typeCreate.mockImplementation(async ({ data }) => ({ ...blog, ...data, id: "type-new" }));
  typeUpdate.mockImplementation(async ({ data }) => ({ ...blog, ...data }));
  bugFindMany.mockResolvedValue([]);
  bugCount.mockResolvedValue(0);
  ideaCount.mockResolvedValue(0);
});

describe("listing", () => {
  it("lists only active marketing types by default, A-Z", async () => {
    typeFindMany.mockResolvedValue([blog]);
    await expect(listMarketingTaskTypes("organisation-1")).resolves.toEqual([blog]);
    expect(typeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organisationId: "organisation-1", track: "marketing", isActive: true }, orderBy: { name: "asc" } }),
    );
  });

  it("includes retired types when asked", async () => {
    typeFindMany.mockResolvedValue([]);
    await listMarketingTaskTypes("organisation-1", { includeInactive: true });
    expect(typeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organisationId: "organisation-1", track: "marketing" } }));
  });

  it("finds the project by id or slug inside the organisation only", async () => {
    projectFindFirst.mockResolvedValueOnce({ id: "proj-1", slug: "web" });
    await expect(marketingTaskTypeProject("organisation-1", "web")).resolves.toEqual({ id: "proj-1", slug: "web" });
    expect(projectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organisationId: "organisation-1", OR: [{ id: "web" }, { slug: "web" }] } }),
    );
    projectFindFirst.mockResolvedValueOnce(null);
    expect((await rejection(marketingTaskTypeProject("organisation-1", "other"))).status).toBe(404);
  });

  it("never returns a product type as a marketing one", async () => {
    await getMarketingTaskType("organisation-1", "type-product").catch(() => undefined);
    expect(typeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "type-product", organisationId: "organisation-1", track: "marketing" } }),
    );
    expect((await rejection(getMarketingTaskType("organisation-1", "type-product"))).status).toBe(404);
  });
});

describe("creating", () => {
  it("stores the type on the marketing track and expires the type cache", async () => {
    const created = await createMarketingTaskType("organisation-1", { name: "  Newsletter ", description: "Monthly." });
    expect(created).toMatchObject({ name: "Newsletter", track: "marketing", isActive: true });
    expect(typeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { organisationId: "organisation-1", name: "Newsletter", description: "Monthly.", track: "marketing", isActive: true },
      }),
    );
    expect(updateTag).toHaveBeenCalled();
  });

  it("refuses a name any type in the organisation uses, ignoring case and track", async () => {
    typeFindFirst.mockResolvedValueOnce({ name: "Fix" });
    const error = await rejection(createMarketingTaskType("organisation-1", { name: "fix" }));
    expect(error.status).toBe(409);
    expect(error.body).toMatchObject({ error: "duplicate_name", field: "name" });
    expect(typeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organisationId: "organisation-1", name: { equals: "fix", mode: "insensitive" } } }),
    );
    expect(typeCreate).not.toHaveBeenCalled();
  });

  it("maps a unique-key race to 409", async () => {
    typeCreate.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    expect((await rejection(createMarketingTaskType("organisation-1", { name: "Newsletter" }))).status).toBe(409);
  });

  it("refuses points and other unknown fields with 422 (D5)", async () => {
    const error = await rejection(createMarketingTaskType("organisation-1", { name: "Newsletter", points: 5 }));
    expect(error.status).toBe(422);
    expect(error.body).toMatchObject({ error: "invalid_request", field: "points" });
  });

  it("refuses a name that is too short with 400 naming the field", async () => {
    const error = await rejection(createMarketingTaskType("organisation-1", { name: "x" }));
    expect(error.status).toBe(400);
    expect(error.body).toMatchObject({ error: "invalid_request", field: "name" });
  });
});

describe("updating", () => {
  it("renames a type and notes it on the tasks that carry it", async () => {
    typeFindFirst.mockResolvedValueOnce(blog).mockResolvedValueOnce(null);
    bugFindMany.mockResolvedValue([{ id: "bug-1" }, { id: "bug-2" }]);
    const updated = await updateMarketingTaskType("organisation-1", "user-1", "type-1", { name: "Blog article" });
    expect(updated.name).toBe("Blog article");
    expect(activityCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ bugId: "bug-1", actorId: "user-1", type: "type_changed", metadata: { field: "type", from: "Blog post", to: "Blog article" } }),
        expect.objectContaining({ bugId: "bug-2" }),
      ],
    });
  });

  it("changes only the fields sent", async () => {
    typeFindFirst.mockResolvedValueOnce(blog);
    await updateMarketingTaskType("organisation-1", "user-1", "type-1", { isActive: false });
    expect(typeUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "type-1" }, data: { isActive: false } }));
    expect(activityCreateMany).not.toHaveBeenCalled();
  });

  it("refuses an empty change", async () => {
    expect((await rejection(updateMarketingTaskType("organisation-1", "user-1", "type-1", {}))).status).toBe(400);
  });

  it("refuses a product type or a missing one with 404", async () => {
    expect((await rejection(updateMarketingTaskType("organisation-1", "user-1", "type-product", { isActive: false }))).status).toBe(404);
    expect(typeUpdate).not.toHaveBeenCalled();
  });

  it("toggles a type between active and retired", async () => {
    typeFindFirst.mockResolvedValue(blog);
    await toggleMarketingTaskTypeActive("organisation-1", "user-1", "type-1");
    expect(typeUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
  });
});

describe("deleting", () => {
  it("deletes a type nothing uses", async () => {
    typeFindFirst.mockResolvedValueOnce(blog);
    await expect(deleteMarketingTaskType("organisation-1", "type-1")).resolves.toEqual({ id: "type-1", deleted: true });
    expect(typeDelete).toHaveBeenCalledWith({ where: { id: "type-1" } });
  });

  it("refuses a type a proposal still uses, and says to deactivate it", async () => {
    typeFindFirst.mockResolvedValueOnce(blog);
    ideaCount.mockResolvedValueOnce(1);
    const error = await rejection(deleteMarketingTaskType("organisation-1", "type-1"));
    expect(error.status).toBe(409);
    expect(error.body).toMatchObject({ error: "type_in_use", issues: 0, ideas: 1 });
    expect(error.message).toContain("Deactivate it instead");
    expect(typeDelete).not.toHaveBeenCalled();
  });
});
