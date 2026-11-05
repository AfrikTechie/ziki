import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { clientRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { consumePairingLimit } from "@/lib/agents/rate-limit";
import { collectPairing } from "@/lib/agents/pairing";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { agentPlatformDisabledResponse } from "@/lib/agents/platform-gate";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site-url";
import { WATCH_WORK_MESSAGE } from "@/lib/agents/pairing-link";
import { projectPath, refOf } from "@/lib/project-paths";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/v1/agents/pairing/token — the waiting agent collects its key
 * (#427). Body: `{ "device_code": "…" }`. Until the owner approves, the
 * answer is `authorization_pending`; after, the key comes back exactly once.
 */
export async function POST(req: NextRequest) {
  const retryAfter = await consumePairingLimit("collect", clientRateLimitKey(req));
  if (retryAfter) {
    return NextResponse.json(
      { error: "slow_down", message: RATE_LIMIT_MESSAGE },
      { status: 429, headers: { "Retry-After": String(retryAfter), ...NO_STORE } },
    );
  }

  // #505: switched off means switched off, not just hidden in Settings.
  if (!isAgentPlatformEnabled()) return agentPlatformDisabledResponse();
  const body = (await req.json().catch(() => null)) as { device_code?: unknown } | null;
  const result = await collectPairing(body?.device_code);
  switch (result.status) {
    case "issued": {
      // The key is shown only in this response, so the work URL is a best effort and never fails it.
      const project = result.projectId
        ? await prisma.project.findUnique({ where: { id: result.projectId }, select: { slug: true, tenant: { select: { slug: true } } } }).catch(() => null)
        : null;
      return NextResponse.json(
        {
          api_key: result.key.rawKey,
          key_prefix: result.key.prefix,
          agent: { id: result.key.agentId, name: result.key.name, level: result.key.level },
          project_id: result.projectId,
          // #work-feed: the project's work URL is where the agent waits for work.
          work_url: project ? absoluteUrl(projectPath(refOf(project), "/work")) : null,
          message: `Store this key now. It is your account and it is not shown again. Confirm with GET /api/v1/agents/me. ${WATCH_WORK_MESSAGE}`,
        },
        { status: 200, headers: NO_STORE },
      );
    }
    case "pending":
      return NextResponse.json(
        { error: "authorization_pending", message: "Waiting for your owner to approve the code." },
        { status: 400, headers: NO_STORE },
      );
    case "expired":
      return NextResponse.json(
        { error: "expired_token", message: "This pairing expired. Start a new one." },
        { status: 400, headers: NO_STORE },
      );
    case "used":
      return NextResponse.json(
        { error: "used_token", message: "This pairing's key was already collected." },
        { status: 400, headers: NO_STORE },
      );
    case "invalid":
      return NextResponse.json(
        { error: "invalid_grant", message: "Unknown device code." },
        { status: 400, headers: NO_STORE },
      );
  }
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
