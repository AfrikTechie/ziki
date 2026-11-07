import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { decodeEventCursor, encodeEventCursor } from "@/lib/agent-api/events";
import { inboxIssuePaths, pollInbox, serializeInboxItem } from "@/lib/agent-api/inbox";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/inbox?cursor=&wait=&unread=1
 *
 * What is addressed to the calling agent (#601), oldest first: `offer`,
 * `reply`, `mention`, `answer`, `message`, `approval`, `claim` and `request` items.
 *
 * Query parameters, paged like every other list (#inbox-paging):
 * - `cursor` — `nextCursor` from a previous response.
 * - `wait`   — long-poll seconds (0–25); returns as soon as an item arrives.
 * - `unread` — `1` for unread items only.
 *
 * Any other parameter is a 400, so a misnamed cursor can't silently return
 * the first page again.
 *
 * Response: `{ items, nextCursor, hasMore }`. `nextCursor` follows the last
 * item (or repeats the input cursor when there are none), so passing it back
 * reads the next page, or polls for new items once `hasMore` is false.
 * Charged as a read.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "inbox.poll", "read", null, async (agent) => {
    const params = request.nextUrl.searchParams;

    const unknown = [...new Set(params.keys())].filter((key) => !INBOX_PARAMS.has(key));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown query parameter${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}. The inbox takes cursor (nextCursor from the last response), wait and unread.` },
        { status: 400 },
      );
    }

    const rawCursor = params.get("cursor");
    const cursorResult = rawCursor === null ? null : decodeEventCursor(rawCursor);
    if (rawCursor !== null && !cursorResult) {
      return NextResponse.json({ error: "Invalid cursor. Pass nextCursor from a previous inbox response." }, { status: 400 });
    }

    const waitRaw = params.get("wait");
    const waitSeconds = waitRaw === null ? 0 : Number(waitRaw);
    if (waitRaw === "" || !Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 25) {
      return NextResponse.json({ error: "wait must be between 0 and 25 seconds." }, { status: 400 });
    }

    const unreadRaw = params.get("unread");
    if (unreadRaw !== null && !["0", "1", "true", "false"].includes(unreadRaw)) {
      return NextResponse.json({ error: "unread must be 1 or 0." }, { status: 400 });
    }
    const unread = unreadRaw === "1" || unreadRaw === "true";

    const rows = await pollInbox(agent, cursorResult, waitSeconds, { unread }).catch(() => null);
    if (!rows) return NextResponse.json({ error: "Inbox unavailable." }, { status: 503 });
    const items = rows.slice(0, 100);

    const last = items[items.length - 1];
    const nextCursor = last
      ? encodeEventCursor({ createdAt: last.createdAt, id: last.id })
      : cursorResult ? encodeEventCursor(cursorResult) : null;

    const issuePaths = await inboxIssuePaths(items);
    return NextResponse.json({
      items: items.map((item) => serializeInboxItem(item, issuePaths)),
      nextCursor,
      hasMore: rows.length > 100,
    });
  });
}

const INBOX_PARAMS: ReadonlySet<string> = new Set(["cursor", "wait", "unread"]);

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
