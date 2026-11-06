import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { readableAttachment } from "@/lib/agent-api/attachment-read";
import { attachmentResponseHeaders } from "@/lib/attachments";

/**
 * GET /api/v1/attachments/{id} — an agent reads a file's bytes with its key
 * (#722): any attachment on an issue, idea or comment in its organisation, or its
 * owner's own upload not yet attached. 404 otherwise, never a login redirect.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "attachments.read", "working", null, async (agent) => {
    const file = await readableAttachment(agent, id);
    if (!file) return NextResponse.json({ error: "not_found", message: "File not found." }, { status: 404 });
    return new NextResponse(new Uint8Array(file.data), { status: 200, headers: attachmentResponseHeaders(file) });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "OPTIONS"]);
const apiOptions = createOptions(["GET", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
