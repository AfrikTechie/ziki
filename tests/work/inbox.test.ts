import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 1. Corrected the mocks to include supportThread, threadMessage, and the other missing models
const db = vi.hoisted(() => ({
  agentInboxItem: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  bug: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  agentQuestion: { findMany: vi.fn() },
  notification: { updateMany: vi.fn(), count: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  membership: { count: vi.fn(), findFirst: vi.fn() },
  agent: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  supportThread: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  threadMessage: { create: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "owner-1" })) }));
vi.mock("@/lib/organisation-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organisation-context")>()),
  currentOrganisationIdFor: vi.fn(async () => "organisation-a"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const expireUnreadCounts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cache-tags", () => ({ expireTag: vi.fn(), TAGS: { unread: (id: string) => `unread:${id}` }, expireUnreadCounts }));

const markMessagesRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-messages", () => ({ markMessagesRead }));

// 2. Moved all imports to the top
import { inboxRecipients, listInbox, markInboxRead, writeInbox, type InboxEvent } from "@/lib/agent-api/inbox";
import { publish } from "@/lib/agent-api/events";
import { escalationOnTrack, escalationTrackWhere, notificationTrackWhere, parseInboxTrack } from "@/lib/my-work-filter";
import { listOwnerQuestions } from "@/lib/agent-questions";
import { markAllNotificationsReadAction } from "@/app/actions/notifications";
import { NotificationsView } from "@/app/(app)/inbox/notifications-view";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { createSupportThreadAction } from "@/app/actions/support-threads";
import {
  createSupportThread,
  addRequesterMessage,
  takeSupportThread,
  replySupportThread,
  releaseSupportThread,
  resolveSupportThread,
  closeSupportThreadsForIssue,
  supportThreadVisibilityWhere,
  countOpenRequestsForUser,
} from "@/lib/support-threads";

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
        // #user-agents: about an issue there, or asked there by an agent active in it.
        AND: [
          { OR: [{ bug: { organisationId: "organisation-a" } }, { bugId: null, agent: { activations: { some: { organisationId: "organisation-a", deactivatedAt: null } } } }] },
          { bug: { is: { track: "marketing" } } },
        ],
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

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  db.$executeRaw.mockResolvedValue(1);
});
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
    expect(t.agent.findMany).toHaveBeenLastCalledWith({ where: { id: { in: ["agent-elsewhere"] }, activations: { some: { organisationId: "organisation-a", deactivatedAt: null } }, revokedAt: null }, select: { id: true } });
    expect(t.agentInboxItem.createMany).not.toHaveBeenCalled();
  });

  it("writes one item per agent and skips revoked or out-of-organisation agents", async () => {
    const t = tx({ agent: { findMany: vi.fn()
      .mockResolvedValueOnce([{ id: "agent-bob" }, { id: "agent-gone" }])
      .mockResolvedValueOnce([{ id: "agent-bob" }]) } });
    t.comment.findUnique.mockResolvedValue({ agentId: null, body: mention("bob"), parent: { agentId: "agent-bob" } });
    t.agentInboxItem.createMany.mockResolvedValue({ count: 1 });
    expect(await writeInbox(t as never, { id: "event-1", organisationId: "organisation-a", type: "comment.created", bugId: "bug-1", payload: { commentId: "c2" } })).toBe(1);
    expect(t.agent.findMany).toHaveBeenLastCalledWith({ where: { id: { in: ["agent-bob", "agent-gone"] }, activations: { some: { organisationId: "organisation-a", deactivatedAt: null } }, revokedAt: null }, select: { id: true } });
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

describe("Support Threads Domain Logic", () => {
  const user = { id: "user-alice", name: "Alice" };
  const organisationId = "organisation-1";
  const issueId = "bug-1";

  describe("createSupportThread", () => {
    it("creates thread and fans out to eligible manager/merger agents excluding requester's own", async () => {
      db.bug.findFirst.mockResolvedValue({
        id: issueId,
        number: 42,
        title: "Stuck in progress fix",
        status: "in_progress",
        organisationId,
      });

      db.supportThread.findFirst.mockResolvedValue(null);
      db.supportThread.create.mockResolvedValue({ id: "thread-1" });
      db.agent.findMany.mockResolvedValue([
        { id: "agent-manager-1" },
        { id: "agent-merger-1" },
      ]);

      const res = await createSupportThread(user, organisationId, issueId, "Need help with the PR");

      expect(res).toEqual({ ok: true, threadId: "thread-1", existing: false });
      expect(db.$executeRaw).toHaveBeenCalled();
      expect(db.supportThread.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organisationId,
            bugId: issueId,
            requesterUserId: user.id,
            status: "open",
            messages: {
              create: {
                authorUserId: user.id,
                body: "Need help with the PR",
              },
            },
          }),
        }),
      );

      expect(db.agent.findMany).toHaveBeenCalledWith({
        where: {
          revokedAt: null,
          ownerUserId: { not: user.id },
          activations: {
            some: {
              organisationId,
              deactivatedAt: null,
              level: { in: ["manager", "merger"] },
            },
          },
        },
        select: { id: true },
      });

      expect(db.agentInboxItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            agentId: "agent-manager-1",
            kind: "request",
            eventType: "request.created",
            bugId: issueId,
            payload: expect.objectContaining({
              threadId: "thread-1",
              bugId: issueId,
              issue: { number: 42, title: "Stuck in progress fix" },
              from: { type: "user", id: user.id, name: user.name },
              body: "Need help with the PR",
            }),
          }),
          expect.objectContaining({
            agentId: "agent-merger-1",
            kind: "request",
            eventType: "request.created",
            bugId: issueId,
          }),
        ],
      });
    });

    it("returns error if issue is not found or not in organisation", async () => {
      db.bug.findFirst.mockResolvedValue(null);
      const res = await createSupportThread(user, organisationId, "nonexistent", "Hello");
      expect(res).toEqual({ ok: false, error: "Issue not found." });
    });

    it("returns error if issue is in non-askable status", async () => {
      db.bug.findFirst.mockResolvedValue({
        id: issueId,
        number: 42,
        title: "Open issue",
        status: "open",
        organisationId,
      });

      const res = await createSupportThread(user, organisationId, issueId, "Hello");
      expect(res).toEqual({
        ok: false,
        error: "You can only ask about fixes that are in progress, done, or in merge.",
      });
    });

    it("returns existing active thread without duplicate creation", async () => {
      db.bug.findFirst.mockResolvedValue({
        id: issueId,
        number: 42,
        title: "Stuck fix",
        status: "in_progress",
        organisationId,
      });
      db.supportThread.findFirst.mockResolvedValue({ id: "existing-thread-1" });

      const res = await createSupportThread(user, organisationId, issueId, "Another question");
      expect(res).toEqual({ ok: true, threadId: "existing-thread-1", existing: true });
      expect(db.supportThread.create).not.toHaveBeenCalled();
      expect(db.agentInboxItem.createMany).not.toHaveBeenCalled();
    });
  });

  describe("addRequesterMessage", () => {
    it("allows requester to add message and notifies assignee when taken", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        bugId: issueId,
        organisationId,
        requesterUserId: user.id,
        status: "taken",
        assigneeAgentId: "agent-1",
        bug: { number: 42, title: "Stuck fix" },
      });
      db.agent.findUnique.mockResolvedValue({ ownerUserId: "user-bob" });

      const res = await addRequesterMessage(user, organisationId, "thread-1", "Any update?");
      expect(res).toEqual({ ok: true });
      expect(db.threadMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            threadId: "thread-1",
            authorUserId: user.id,
            body: "Any update?",
          }),
        }),
      );
      expect(db.agentInboxItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentId: "agent-1",
            kind: "request",
            eventType: "request.message",
          }),
        }),
      );
      expect(db.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: "user-bob",
            kind: "support_thread",
            title: "New message on #42: Stuck fix",
          }),
        ],
      });
      expect(expireUnreadCounts).toHaveBeenCalledWith(["user-bob"]);
    });

    it("rejects non-requester messages", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        requesterUserId: "someone-else",
        status: "open",
        bug: { number: 42, title: "Stuck fix" },
      });

      const res = await addRequesterMessage(user, organisationId, "thread-1", "Hello");
      expect(res).toEqual({ ok: false, error: "Only the requester can add follow-up messages." });
    });

    it("rejects messages on resolved threads", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        requesterUserId: user.id,
        status: "resolved",
        bug: { number: 42, title: "Stuck fix" },
      });

      const res = await addRequesterMessage(user, organisationId, "thread-1", "Hello");
      expect(res).toEqual({ ok: false, error: "This request has already been resolved." });
    });
  });

  describe("takeSupportThread", () => {
    const bob = { id: "user-bob" };

    it("requires caller to own an eligible manager or merger agent", async () => {
      db.agent.findFirst.mockResolvedValue(null);
      const res = await takeSupportThread(bob, organisationId, "thread-1", "agent-invalid");
      expect(res).toEqual({ ok: false, error: "You must choose an active manager or merger agent you own." });
    });

    it("prevents requester from taking their own thread", async () => {
      db.agent.findFirst.mockResolvedValue({ id: "agent-mgr", name: "Agent Manager" });
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        requesterUserId: bob.id,
        status: "open",
        bug: { number: 42, title: "Fix" },
      });

      const res = await takeSupportThread(bob, organisationId, "thread-1", "agent-mgr");
      expect(res).toEqual({ ok: false, error: "You cannot take your own request." });
    });

    it("handles race where another agent took it first (updateMany count === 0)", async () => {
      db.agent.findFirst.mockResolvedValue({ id: "agent-mgr", name: "Agent Manager" });
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        requesterUserId: "user-alice",
        status: "open",
        bug: { number: 42, title: "Fix" },
      });
      db.supportThread.updateMany.mockResolvedValue({ count: 0 });

      const res = await takeSupportThread(bob, organisationId, "thread-1", "agent-mgr");
      expect(res).toEqual({ ok: false, error: "Someone already took this request." });
    });

    it("takes thread atomically and notifies requester on success", async () => {
      db.agent.findFirst.mockResolvedValue({ id: "agent-mgr", name: "Agent Manager" });
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        bugId: issueId,
        requesterUserId: "user-alice",
        status: "open",
        bug: { number: 42, title: "Fix" },
      });
      db.supportThread.updateMany.mockResolvedValue({ count: 1 });

      const res = await takeSupportThread(bob, organisationId, "thread-1", "agent-mgr");
      expect(res).toEqual({ ok: true });
      expect(db.supportThread.updateMany).toHaveBeenCalledWith({
        where: { id: "thread-1", organisationId, status: "open" },
        data: expect.objectContaining({
          status: "taken",
          assigneeAgentId: "agent-mgr",
        }),
      });
      expect(db.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: "user-alice",
            kind: "support_thread",
            title: "Agent Manager took your request on #42",
          }),
        ],
      });
      expect(expireUnreadCounts).toHaveBeenCalledWith(["user-alice"]);
    });
  });

  describe("replySupportThread", () => {
    const bob = { id: "user-bob" };

    it("only allows the assignee agent's owner to reply", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        status: "taken",
        assigneeAgent: { id: "agent-mgr", name: "Agent Manager", ownerUserId: "user-other" },
        bug: { number: 42, title: "Fix" },
      });

      const res = await replySupportThread(bob, organisationId, "thread-1", "Here is the answer");
      expect(res).toEqual({ ok: false, error: "Only the owner of the assigned agent can reply." });
    });

    it("refuses replies when thread is not taken", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        status: "open",
        assigneeAgent: null,
        bug: { number: 42, title: "Fix" },
      });

      const res = await replySupportThread(bob, organisationId, "thread-1", "Here is the answer");
      expect(res).toEqual({ ok: false, error: "Can only reply to taken requests." });
    });

    it("records reply message as the assigned agent and notifies requester", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        bugId: issueId,
        requesterUserId: "user-alice",
        status: "taken",
        assigneeAgentId: "agent-mgr",
        assigneeAgent: { id: "agent-mgr", name: "Agent Manager", ownerUserId: bob.id },
        bug: { number: 42, title: "Fix" },
      });

      const res = await replySupportThread(bob, organisationId, "thread-1", "We restarted CI and checks are passing.");
      expect(res).toEqual({ ok: true });
      expect(db.threadMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            threadId: "thread-1",
            authorUserId: bob.id,
            authorAgentId: "agent-mgr",
            body: "We restarted CI and checks are passing.",
          }),
        }),
      );
      expect(db.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: "user-alice",
            kind: "support_thread",
            title: "Agent Manager replied to your request on #42",
          }),
        ],
      });
      expect(expireUnreadCounts).toHaveBeenCalledWith(["user-alice"]);
    });
  });

  describe("releaseSupportThread", () => {
    const bob = { id: "user-bob" };

    it("resets thread to open and fans out request.released to eligible agents", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        bugId: issueId,
        requesterUserId: "user-alice",
        status: "taken",
        assigneeAgent: { id: "agent-mgr", name: "Agent Manager", ownerUserId: bob.id },
        requester: { id: "user-alice", name: "Alice" },
        bug: { number: 42, title: "Fix" },
      });
      db.agent.findMany.mockResolvedValue([{ id: "agent-other-mgr" }]);
      db.supportThread.updateMany.mockResolvedValue({ count: 1 });

      const res = await releaseSupportThread(bob, organisationId, "thread-1");
      expect(res).toEqual({ ok: true });
      expect(db.supportThread.updateMany).toHaveBeenCalledWith({
        where: { id: "thread-1", status: "taken", assigneeAgentId: "agent-mgr" },
        data: expect.objectContaining({
          status: "open",
          assigneeAgentId: null,
          takenAt: null,
        }),
      });
      expect(db.agentInboxItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            agentId: "agent-other-mgr",
            kind: "request",
            eventType: "request.released",
          }),
        ],
      });
    });

    it("does not reopen a thread that was resolved after it was read, and tells no agent", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        bugId: issueId,
        requesterUserId: "user-alice",
        status: "taken",
        assigneeAgent: { id: "agent-mgr", name: "Agent Manager", ownerUserId: bob.id },
        requester: { id: "user-alice", name: "Alice" },
        bug: { number: 42, title: "Fix" },
      });
      db.supportThread.updateMany.mockResolvedValue({ count: 0 });

      const res = await releaseSupportThread(bob, organisationId, "thread-1");
      expect(res).toEqual({ ok: false, error: expect.any(String) });
      expect(db.agentInboxItem.createMany).not.toHaveBeenCalled();
    });
  });

  describe("resolveSupportThread", () => {
    it("allows requester to resolve manually and notifies assignee owner", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        bugId: issueId,
        requesterUserId: user.id,
        status: "taken",
        assigneeAgent: { id: "agent-mgr", ownerUserId: "user-bob" },
        bug: { number: 42, title: "Fix" },
      });

      const res = await resolveSupportThread(user, organisationId, "thread-1");
      expect(res).toEqual({ ok: true });
      expect(db.supportThread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: expect.objectContaining({
          status: "resolved",
          resolvedReason: "manual",
        }),
      });
      expect(db.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: "user-bob",
            title: "Request on #42 marked resolved",
          }),
        ],
      });
    });

    it("refuses resolution by unrelated user", async () => {
      db.supportThread.findFirst.mockResolvedValue({
        id: "thread-1",
        organisationId,
        requesterUserId: "user-alice",
        status: "taken",
        assigneeAgent: { id: "agent-mgr", ownerUserId: "user-bob" },
        bug: { number: 42, title: "Fix" },
      });

      const res = await resolveSupportThread({ id: "user-stranger" }, organisationId, "thread-1");
      expect(res).toEqual({
        ok: false,
        error: "Only the requester or the assigned agent's owner can resolve this request.",
      });
    });
  });

  describe("visibility and count", () => {
    it("restricts visibility to own requests if user owns no eligible agent", async () => {
      db.agent.count.mockResolvedValue(0);
      const where = await supportThreadVisibilityWhere("user-plain", organisationId);
      expect(where).toEqual({
        organisationId,
        requesterUserId: "user-plain",
      });
    });

    it("broadens visibility to open threads and assigned threads if user owns eligible agent", async () => {
      db.agent.count.mockResolvedValue(1);
      const where = await supportThreadVisibilityWhere("user-mgr", organisationId);
      expect(where).toEqual({
        organisationId,
        OR: [
          { requesterUserId: "user-mgr" },
          { status: "open" },
          { assigneeAgent: { ownerUserId: "user-mgr" } },
        ],
      });
    });

    it("returns 0 open count if user owns no eligible agents", async () => {
      db.agent.count.mockResolvedValue(0);
      const count = await countOpenRequestsForUser("user-plain", organisationId);
      expect(count).toBe(0);
      expect(db.supportThread.count).not.toHaveBeenCalled();
    });

    it("returns open requests count excluding own requests if user owns eligible agents", async () => {
      db.agent.count.mockResolvedValue(2);
      db.supportThread.count.mockResolvedValue(3);

      const count = await countOpenRequestsForUser("user-mgr", organisationId);
      expect(count).toBe(3);
      expect(db.supportThread.count).toHaveBeenCalledWith({
        where: {
          organisationId,
          status: "open",
          requesterUserId: { not: "user-mgr" },
        },
      });
    });
  });

  describe("closeSupportThreadsForIssue", () => {
    it("is a no-op when no active threads exist", async () => {
      const tx = {
        supportThread: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
        notification: { createMany: vi.fn() },
      };

      await closeSupportThreadsForIssue(tx as never, { bugId: "bug-none", reason: "fix_live" });
      expect(tx.supportThread.updateMany).not.toHaveBeenCalled();
      expect(tx.notification.createMany).not.toHaveBeenCalled();
    });

    it("resolves active threads and creates notifications for requesters and assignees", async () => {
      const tx = {
        supportThread: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "t-1",
              organisationId: "t1",
              requesterUserId: "user-req",
              assigneeAgent: { ownerUserId: "user-agent-owner" },
              bug: { number: 10, title: "Resolved bug" },
            },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        notification: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      };

      await closeSupportThreadsForIssue(tx as never, { bugId: "bug-10", reason: "fix_live" });

      expect(tx.supportThread.updateMany).toHaveBeenCalledWith({
        where: { bugId: "bug-10", status: { in: ["open", "taken"] } },
        data: expect.objectContaining({
          status: "resolved",
          resolvedReason: "fix_live",
        }),
      });

      expect(tx.notification.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: "user-req",
            title: "Request on #10 resolved (fix is now live)",
          }),
          expect.objectContaining({
            userId: "user-agent-owner",
            title: "Request on #10 resolved (fix is now live)",
          }),
        ]),
      });
      expect(expireUnreadCounts).toHaveBeenCalledWith(["user-req", "user-agent-owner"]);
    });
  });

        describe("Support Thread Permissions (Action)", () => {
    const mockUser = { id: "user-1" };
    const issueId = "bug-1";
    const orgId = "org-1";

    beforeEach(() => {
      vi.mocked(requireUser).mockResolvedValue(mockUser as never);
    });

    it("refuses a stranger (non-member) from creating a thread", async () => {
      vi.mocked(db.bug.findFirst).mockResolvedValue({
        id: issueId,
        organisationId: orgId,
        status: "in_progress",
        number: 42,
        title: "Test Issue",
      } as never);
      vi.mocked(db.bug.findUnique).mockResolvedValue({
        id: issueId,
        organisationId: orgId,
        status: "in_progress",
        number: 42,
        title: "Test Issue",
      } as never);

      vi.mocked(db.membership.findFirst).mockResolvedValue(null);

      const result = await createSupportThreadAction({ issueId, body: "Help!" });
      expect(result).toEqual({
        ok: false,
        error: "You must be a member of this organisation to ask about this issue.",
      });
      expect(db.supportThread.create).not.toHaveBeenCalled();
    });

    it("succeeds for a member even if they have a different organisation selected", async () => {
      vi.mocked(db.bug.findFirst).mockResolvedValue({
        id: issueId,
        organisationId: orgId,
        status: "in_progress",
        number: 42,
        title: "Test Issue",
      } as never);
      vi.mocked(db.bug.findUnique).mockResolvedValue({
        id: issueId,
        organisationId: orgId,
        status: "in_progress",
        number: 42,
        title: "Test Issue",
      } as never);

      vi.mocked(db.membership.findFirst).mockResolvedValue({
        id: "membership-1",
        userId: "user-1",
        organisationId: orgId,
      } as never);

      vi.mocked(db.supportThread.findFirst).mockResolvedValue(null);
      vi.mocked(db.supportThread.create).mockResolvedValue({ id: "thread-1" } as never);
      
      // This fixes the "Cannot read properties of undefined (reading 'length')" error
      vi.mocked(db.agent.findMany).mockResolvedValue([]);
      vi.mocked(db.agentInboxItem.createMany).mockResolvedValue({ count: 0 } as never);

      const result = await createSupportThreadAction({ issueId, body: "Help!" });

      if (!result.ok) {
        throw new Error(`Expected success, but got: ${result.error}`);
      }

      expect(result.threadId).toBe("thread-1");
      expect(db.supportThread.create).toHaveBeenCalled();
    });
  });
});