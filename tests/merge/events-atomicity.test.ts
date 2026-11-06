import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock prisma before imports
// ---------------------------------------------------------------------------
/** A state change and its event go together (#524): an event is broadcast only once its row is committed, never for a rolled-back write. */
const db = vi.hoisted(() => ({
  agentEvent: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { publish, broadcastWhenCommitted } from "@/lib/agent-api/events";
import { eventStreamBus, type StreamEvent } from "@/lib/events/stream-bus";

function streamEvent(id: string): StreamEvent {
  return {
    id,
    type: "issue.confirmation",
    payload: { bugId: "bug-1" },
    actorAgentId: "agent-a",
    bugId: "bug-1",
    organisationId: "organisation-a",
    createdAt: new Date("2026-10-22T07:37:59.000Z"),
  };
}

/**
 * #524: an event and the row it describes have to land together. Publishing
 * inside the writing transaction let a subscriber read an event whose change
 * was not there yet, and a rolled-back transaction still emitted its event.
 */
describe("event broadcast waits for the committed row (#524)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    db.agentEvent.findUnique.mockReset();
  });

  it("drops the event when the transaction rolled back and the row never appears", async () => {
    db.agentEvent.findUnique.mockResolvedValue(null);
    const broadcast = vi.spyOn(eventStreamBus, "broadcast");

    const sent = await broadcastWhenCommitted(streamEvent("evt-rolled-back"), { attempts: 3, delayMs: 1 });

    expect(sent).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("broadcasts once the row is visible", async () => {
    db.agentEvent.findUnique.mockResolvedValue({ id: "evt-committed" });
    const broadcast = vi.spyOn(eventStreamBus, "broadcast");

    const sent = await broadcastWhenCommitted(streamEvent("evt-committed"), { attempts: 3, delayMs: 1 });

    expect(sent).toBe(true);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt-committed", type: "issue.confirmation" }),
    );
  });

  it("waits for a transaction that is still running", async () => {
    db.agentEvent.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: "evt-late" });
    const broadcast = vi.spyOn(eventStreamBus, "broadcast");

    const sent = await broadcastWhenCommitted(streamEvent("evt-late"), { attempts: 3, delayMs: 1 });

    expect(sent).toBe(true);
    expect(db.agentEvent.findUnique).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("publishes nothing before the writing transaction commits", async () => {
    // The row is invisible to other connections while the transaction runs,
    // so the event must not reach subscribers yet.
    db.agentEvent.create.mockResolvedValue({ id: "evt-pending" });
    db.webhookSubscription.findMany.mockResolvedValue([]);
    db.agentEvent.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: "evt-pending" });
    const broadcast = vi.spyOn(eventStreamBus, "broadcast");

    const result = await publish(db as unknown as Parameters<typeof publish>[0], {
      organisationId: "organisation-a",
      type: "issue.confirmation",
      payload: { bugId: "bug-1" },
      actorAgentId: "agent-a",
      bugId: "bug-1",
    });

    expect(result.id).toBe("evt-pending");
    expect(broadcast).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledTimes(1));
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ id: "evt-pending" }));
  });

  it("drops the event when the row lookup keeps failing", async () => {
    // A failing lookup leaves the row's visibility unknown, so the event may
    // describe a change that never happened. It must not be sent on a guess.
    db.agentEvent.findUnique.mockRejectedValue(new Error("connection lost"));
    const broadcast = vi.spyOn(eventStreamBus, "broadcast");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sent = await broadcastWhenCommitted(streamEvent("evt-unknown"), { attempts: 3, delayMs: 1 });

    expect(sent).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
    expect(db.agentEvent.findUnique).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

});
