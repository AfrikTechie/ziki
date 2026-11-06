import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { parseEventCursor, eventCursorError, parseEventFilters, pollEvents, encodeEventCursor, scopeEventFilters } from "@/lib/agent-api/events";
import { AgentProjectError } from "@/lib/agents/require-agent";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/events?after=&afterId=&wait=&types=&projectId=&bugId=&track=
 *
 * Returns agent events for the caller's tenant in ascending order (oldest first).
 *
 * Query parameters:
 * - `after`    — opaque cursor from a previous response, or an ISO-8601 timestamp.
 * - `afterId`  — required when `after` is a timestamp; ties-breaks events at the same time.
 * - `wait`     — long-poll seconds (0–25). `0` or absent returns immediately.
 * - `types`    — comma list of event types or prefixes (`claim.*`); an unknown
 *                type returns 400 with `validTypes`.
 * - `projectId`, `bugId` — only events for that project / issue. A key scoped
 *                to one project (#405) may only ever use its own project
 *                here: a foreign `projectId` answers `403 project_forbidden`,
 *                a foreign or unknown `bugId` is rejected, and an unfiltered
 *                poll is narrowed to the key's project.
 * - `track`    — filter events by track ("product" or "marketing").
 *
 * Filters combine (AND). The cursor is global, so a filtered poll can resume
 * from any cursor this endpoint returned (#602).
 *
 * The response shape:
 * ```json
 * {
 *   "events": [...],
 *   "cursor": "<next-cursor>",
 *   "hasMore": false
 * }
 * ```
 *
 * `cursor` is the position after the last returned event. Pass it as `after`
 * on the next call. Empty responses retain the input cursor; it is null only
 * when there was no input cursor and no events were returned.
 *
 * Rate: charged as a read.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "events.poll", "read", null, async (agent) => {
    const params = request.nextUrl.searchParams;

    const cursorResult = parseEventCursor(params);
    if (cursorResult === "invalid") {
      return NextResponse.json({ error: eventCursorError(params) }, { status: 400 });
    }

    const waitRaw = params.get("wait");
    const waitSeconds = waitRaw === null ? 0 : Number(waitRaw);
    if (waitRaw === "" || !Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 25) {
      return NextResponse.json({ error: "wait must be between 0 and 25 seconds." }, { status: 400 });
    }

    const filters = parseEventFilters(params);
    if ("error" in filters) return NextResponse.json(filters, { status: 400 });

    // #405: a project-scoped key never reads another project's events. A
    // foreign `projectId` throws and the wrapper answers `project_forbidden`;
    // a foreign/missing `bugId` is rejected here; an unfiltered poll is
    // narrowed to the key's project. A lookup failure must not crash the
    // route callback: `AgentProjectError` is rethrown (still `project_forbidden`),
    // anything unexpected becomes the same structured 503 as a feed failure.
    let scoped: Awaited<ReturnType<typeof scopeEventFilters>>;
    try {
      scoped = await scopeEventFilters(agent, filters);
    } catch (error) {
      if (error instanceof AgentProjectError) throw error;
      return NextResponse.json({ error: "Event feed unavailable." }, { status: 503 });
    }
    if ("status" in scoped) return NextResponse.json({ error: scoped.error }, { status: scoped.status });

    const rows = await pollEvents(agent, cursorResult, waitSeconds, scoped.filters).catch(() => null);
    if (!rows) return NextResponse.json({ error: "Event feed unavailable." }, { status: 503 });
    const events = rows.slice(0, 100);

    const last = events[events.length - 1];
    const cursor = last
      ? encodeEventCursor({ txid: last.txid, id: last.id })
      : cursorResult ? encodeEventCursor(cursorResult) : null;

    return NextResponse.json({
      events: events.map((e) => {
        const payload = (e.payload && typeof e.payload === "object") ? (e.payload as Record<string, unknown>) : {};
        const track = (payload.track as string | undefined) ?? null;
        return {
          id: e.id,
          type: e.type,
          payload: e.payload,
          actorAgentId: e.actorAgentId,
          bugId: e.bugId,
          createdAt: e.createdAt.toISOString(),
          ...(track ? { track } : {}),
        };
      }),
      cursor,
      hasMore: rows.length > 100,
    });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
