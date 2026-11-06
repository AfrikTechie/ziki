import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { prisma } from "@/lib/prisma";
import { decodePointCursor, pointEntries, pointEntriesQuerySchema } from "@/lib/points/entries";

export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "points.entries", "read", null, async agent => {
    const parsed = pointEntriesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Invalid ledger query.", details: parsed.error.issues }, { status: 400 });
    if (parsed.data.cursor) {
      try { decodePointCursor(parsed.data.cursor); }
      catch { return NextResponse.json({ error: "Invalid points cursor." }, { status: 400 }); }
    }
    const page = await pointEntries(prisma, {
      organisationId: agent.organisationId, userId: agent.ownerId,
    }, parsed.data);
    return NextResponse.json({ user_id: agent.ownerId, organisation_id: agent.organisationId, ...page });
  });
}
const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "HEAD", "OPTIONS"]);
