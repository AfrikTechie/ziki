/**
 * In-process notice of committed events and writes. The work feed listens to
 * drop its cached view of a organisation (lib/agent-api/work.ts). Agents read events
 * with `GET /api/v1/events` or receive them as webhooks.
 */
import { EventEmitter } from "node:events";

export type StreamEvent = {
  id: string;
  type: string;
  payload: unknown;
  actorAgentId: string | null;
  bugId: string | null;
  projectId?: string | null;
  organisationId: string;
  createdAt: Date | string;
};

class EventStreamBus extends EventEmitter {
  /** Hand a committed event to in-process listeners (the work feed's cache). */
  broadcast(event: StreamEvent): void {
    this.emit("event", event);
  }
}

export const eventStreamBus = new EventStreamBus();

/** Emitted with a organisation id once an agent write has committed (#work-feed), ahead of its event broadcast. */
export const ORGANISATION_WRITE = "organisation-write";
