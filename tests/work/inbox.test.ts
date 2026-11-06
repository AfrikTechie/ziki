import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The agent inbox: an actionable event lands once, in the right agent's inbox only, and can be acknowledged. */
const db = vi.hoisted(() => ({
  agentInboxItem: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  bug: { findMany: vi.fn() },
  agentQuestion: { findMany: vi.fn() },
  notification: { updateMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  membership: { count: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "owner-1" })) }));
vi.mock("@/lib/organisation-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisation-context")>()),
  currentOrganisationIdFor: vi.fn(async () => "organisation-a"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache-tags", () => ({ expireTag: vi.fn(), TAGS: { unread: (id: string) => `unread:${id}` } }));
const markMessagesRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-messages", () => ({ markMessagesRead }));

import { inboxRecipients, listInbox, markInboxRead, writeInbox, type InboxEvent } from "@/lib/agent-api/inbox";
import { publish } from "@/lib/agent-api/events";
import { escalationOnTrack, escalationTrackWhere, notificationTrackWhere, parseInboxTrack } from "@/lib/my-work-filter";
import { listOwnerQuestions } from "@/lib/agent-questions";
import { markAllNotificationsReadAction } from "@/app/actions/notifications";
import { NotificationsView } from "@/app/(app)/inbox/notifications-view";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";

describe("the person's Inbox track filter (M-UI-8)", () => {
  it("hides nothing until the person picks a track", () => {
    expect(parseInboxTrack(undefined)).toBe("all");
    expect(parseInboxTrack("nonsense")).toBe("all");
    expect(notificationTrackWhere("all")).toEqual({});
    expect(escalationOnTrack(null, "all")).toBe(true);
    expect(escalationOnTrack({ track: "marketing" }, "all")).toBe(true);
  });

  it("keeps only marketing work under Marketing", () => {
    expect(notificationTrackWhere("marketing")).toEqual({ bug: { track: "marketing" } });
    expect(escalationOnTrack({ track: "marketing" }, "marketing")).toBe(true);
    expect(escalationOnTrack({ track: "product" }, "marketing")).toBe(false);
    expect(escalationOnTrack(null, "marketing")).toBe(false);
  });

  it("keeps items with no issue under Product, without overwriting the organisation scope's OR", () => {
    expect(notificationTrackWhere("product")).toEqual({
      AND: [{ OR: [{ bugId: null }, { bug: { track: "product" } }] }],
    });
    expect(notificationTrackWhere("product")).not.toHaveProperty("OR");
    expect(escalationOnTrack(null, "product")).toBe(true);
    expect(escalationOnTrack({ track: "product" }, "product")).toBe(true);
    expect(escalationOnTrack({ track: "marketing" }, "product")).toBe(false);
  });

  it("filters owner questions by track before the bounded query while keeping owner and organisation scope", async () => {
    db.agentQuestion.findMany.mockResolvedValue([]);

    await listOwnerQuestions("owner-1", "organisation-a", "marketing");

    expect(db.agentQuestion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownerUserId: "owner-1",
        agent: { organisationId: "organisation-a" },
        bug: { is: { track: "marketing" } },
      },
      take: 100,
    }));
    expect(escalationTrackWhere("product")).toEqual({
      OR: [{ bugId: null }, { bug: { is: { track: "product" } } }],
    });
    expect(escalationTrackWhere("all")).toEqual({});
  });
});

describe("track-scoped mark-all-read", () => {
  it("counts unread only on the selected track, so the button matches what it can mark", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "owner-1" } as never);
    vi.mocked(currentOrganisationIdFor).mockResolvedValue("organisation-a");
    db.notification.count.mockResolvedValue(0);
    db.notification.findMany.mockResolvedValue([]);
    db.membership.count.mockResolvedValue(1);

    await NotificationsView({ searchParams: Promise.resolve({ track: "marketing" }) });

    expect(db.notification.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: "owner-1", readAt: null, bug: { track: "marketing" } }),
    });
  });

  it.each([
    {
      name: "Marketing in this organisation",
      allOrganisations: false,
      track: "marketing",
      expectedScope: { OR: [{ organisationId: null }, { organisationId: "organisation-a" }, { kind: "organisation_invite" }] },
      expectedTrack: { bug: { track: "marketing" } },
    },
    {
      name: "Product in this organisation",
      allOrganisations: false,
      track: "product",
      expectedScope: { OR: [{ organisationId: null }, { organisationId: "organisation-a" }, { kind: "organisation_invite" }] },
      expectedTrack: { AND: [{ OR: [{ bugId: null }, { bug: { track: "product" } }] }] },
    },
    {
      name: "All tracks in this organisation",
      allOrganisations: false,
      track: "all",
      expectedScope: { OR: [{ organisationId: null }, { organisationId: "organisation-a" }, { kind: "organisation_invite" }] },
      expectedTrack: {},
    },
    {
      name: "All tracks across organisations for this user",
      allOrganisations: true,
      track: "all",
      expectedScope: {},
      expectedTrack: {},
    },
  ] as const)("marks $name without crossing user or organisation boundaries", async ({ allOrganisations, track, expectedScope, expectedTrack }) => {
    vi.mocked(requireUser).mockResolvedValue({ id: "owner-1" } as never);
    vi.mocked(currentOrganisationIdFor).mockResolvedValue("organisation-a");
    db.notification.updateMany.mockResolvedValue({ count: 1 });

    await markAllNotificationsReadAction(allOrganisations, track);

    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "owner-1", readAt: null, AND: [expectedScope, expectedTrack] },
      data: { readAt: expect.any(Date) },
    });
    expect(requireUser).toHaveBeenCalledOnce();
    if (allOrganisations) expect(currentOrganisationIdFor).not.toHaveBeenCalled();
    else expect(currentOrganisationIdFor).toHaveBeenCalledWith("owner-1");
  });
});

/** A transaction double with every table the inbox routing reads. */
function tx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    agentEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }) },
    webhookSubscription: { findMany: vi.fn().mockResolvedValue([]) },
    webhookDelivery: { createMany: vi.fn() },
    agentInboxItem: { createMany: vi.fn().mockImplementation(({ data }) => ({ count: data.length })) },
    agent: { findMany: vi.fn().mockImplementation(({ where }) => (where.id?.in ?? []).map((id: string) => ({ id }))) },
    issueClaim: { findUnique: vi.fn().mockResolvedValue({ agentId: "agent-bob" }) },
    comment: { findUnique: vi.fn() },
    bug: { findUnique: vi.fn() },
    redesignProposal: { findUnique: vi.fn() },
    ...overrides,
  };
}
type Tx = ReturnType<typeof tx>;
const run = (t: Tx, event: Omit<InboxEvent, "id" | "organisationId"> & { organisationId?: string }) =>
  inboxRecipients(t as never, { id: "event-1", organisationId: "organisation-a", ...event });

const mention = (userId: string) => `hi @[Owner](${userId})`;
const item = { id: "item-1", kind: "offer", eventId: "event-1", eventType: "claim.offered", bugId: "bug-1", commentId: null,
  payload: { claimId: "claim-1" }, readAt: null, createdAt: new Date("2026-10-20T10:00:00Z") };

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

describe("inbox routing", () => {
  it("gives an offer only to the agent it was made to", async () => {
    const t = tx();
    await publish(t as never, { organisationId: "organisation-a", type: "claim.offered", actorAgentId: "agent-alice", bugId: "bug-1",
      payload: { claimId: "claim-1", issueId: "bug-1" } });
    expect(t.issueClaim.findUnique).toHaveBeenCalledWith({ where: { id: "claim-1" }, select: { agentId: true } });
    expect(t.agentInboxItem.createMany).toHaveBeenCalledWith({ skipDuplicates: true, data: [expect.objectContaining({
      agentId: "agent-bob", kind: "offer", eventId: "event-1", eventType: "claim.offered", bugId: "bug-1",
    })] });
    expect(await run(tx(), { type: "review.requested", payload: { offerId: "o", agentId: "agent-carol" } }))
      .toEqual([{ agentId: "agent-carol", kind: "offer" }]);
  });

  it("puts a reply to an agent's entry in that agent's inbox (#entry-replies-only)", async () => {
    const t = tx();
    t.comment.findUnique.mockResolvedValue({ agentId: null, body: "Please add a test.", parent: null, bid: { agentId: "agent-eli" } });
    expect(await run(t, { type: "comment.created", payload: { commentId: "c5" } }))
      .toEqual([{ agentId: "agent-eli", kind: "reply", commentId: "c5" }]);
  });

  it("does not notify an agent of its own reply or of replies to people", async () => {
    const t = tx();
    t.comment.findUnique.mockResolvedValueOnce({ agentId: "agent-bob", body: "x", parent: { agentId: "agent-bob" } })
      .mockResolvedValueOnce({ agentId: null, body: "x", parent: { agentId: null } });
    expect(await run(t, { type: "comment.created", payload: { commentId: "c2" } })).toEqual([]);
    expect(await run(t, { type: "comment.created", payload: { commentId: "c3" } })).toEqual([]);
  });

  it("writes no item for a mentioned agent outside the event's organisation (#603)", async () => {
    const t = tx({ agent: { findMany: vi.fn().mockResolvedValue([]) } });
    t.comment.findUnique.mockResolvedValue({ agentId: null, body: "@[Other](agent:agent-elsewhere)", parent: null });
    expect(await writeInbox(t as never, { id: "event-1", organisationId: "organisation-a", type: "comment.created", bugId: "bug-1", payload: { commentId: "c1" } })).toBe(0);
    expect(t.agent.findMany).toHaveBeenLastCalledWith({ where: { id: { in: ["agent-elsewhere"] }, organisationId: "organisation-a", revokedAt: null }, select: { id: true } });
    expect(t.agentInboxItem.createMany).not.toHaveBeenCalled();
  });

  it("writes one item per agent and skips revoked or out-of-organisation agents", async () => {
    const t = tx({ agent: { findMany: vi.fn()
      .mockResolvedValueOnce([{ id: "agent-bob" }, { id: "agent-gone" }])
      .mockResolvedValueOnce([{ id: "agent-bob" }]) } });
    t.comment.findUnique.mockResolvedValue({ agentId: null, body: mention("bob"), parent: { agentId: "agent-bob" } });
    t.agentInboxItem.createMany.mockResolvedValue({ count: 1 });
    expect(await writeInbox(t as never, { id: "event-1", organisationId: "organisation-a", type: "comment.created", bugId: "bug-1", payload: { commentId: "c2" } })).toBe(1);
    expect(t.agent.findMany).toHaveBeenLastCalledWith({ where: { id: { in: ["agent-bob", "agent-gone"] }, organisationId: "organisation-a", revokedAt: null }, select: { id: true } });
    expect(t.agentInboxItem.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ agentId: "agent-bob", kind: "reply", commentId: "c2" })]);
  });

});

describe("inbox reads", () => {
  it("lists only this agent's items, optionally unread, after a cursor", async () => {
    db.agentInboxItem.findMany.mockResolvedValue([]);
    const cursor = { createdAt: item.createdAt, id: "item-1" };
    await listInbox({ agentId: "agent-bob" }, cursor, { unread: true });
    expect(db.agentInboxItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      agentId: "agent-bob", readAt: null,
      OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: "item-1" } }],
    }, take: 101 }));
  });

});

describe("marking items read", () => {
  it("marks listed ids of this agent only", async () => {
    db.agentInboxItem.updateMany.mockResolvedValue({ count: 2 });
    expect(await markInboxRead({ agentId: "agent-bob" }, { ids: ["a", "b"] })).toBe(2);
    expect(db.agentInboxItem.updateMany).toHaveBeenCalledWith({
      where: { agentId: "agent-bob", id: { in: ["a", "b"] }, readAt: null, NOT: { eventType: "agent.steer" } }, data: { readAt: expect.any(Date) },
    });
  });

  it("marks everything up to an item, and 404s an unknown anchor", async () => {
    db.agentInboxItem.findFirst.mockResolvedValueOnce({ id: "item-1", createdAt: item.createdAt }).mockResolvedValueOnce(null);
    db.agentInboxItem.updateMany.mockResolvedValue({ count: 3 });
    expect(await markInboxRead({ agentId: "agent-bob" }, { upTo: "item-1" })).toBe(3);
    expect(db.agentInboxItem.updateMany.mock.calls[0][0].where).toEqual({ agentId: "agent-bob", readAt: null, NOT: { eventType: "agent.steer" },
      OR: [{ createdAt: { lt: item.createdAt } }, { createdAt: item.createdAt, id: { lte: "item-1" } }] });
    expect(await markInboxRead({ agentId: "agent-bob" }, { upTo: "other-agents-item" })).toBeNull();
  });

});
