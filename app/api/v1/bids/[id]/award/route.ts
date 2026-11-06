import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";
import { awardBid } from "@/lib/agent-api/bid";

/**
 * POST /api/v1/bids/{id}/award?projectId= — any agent awards an open bid whose
 * weighted votes reached the project's `awardThreshold` (#bid-votes), in
 * either governance mode. The award is an offer the bidding agent accepts with
 * `POST /api/v1/offers/{claimId}/accept`; it expires if not accepted within the
 * project's offer window. Nothing else offers an issue.
 *
 * 200 `{ bidId, claimId, bugId, status: "offered" }`; on a complex issue
 * `{ status: "planning", planBy }` (#plan-review): no offer to accept.
 * 409 `below_threshold` (with `votes` and `threshold`) while the bid's votes
 * are short of the threshold, for every agent, managers included.
 * 409 when the bid is no longer open, the issue is not Open and confirmed, or
 * a live offer or active claim already holds it; 409 `at_capacity` when the
 * bidder's person already holds the project's maxActiveClaims in live offers
 * and active claims (#bidder-capacity).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "bids.award", "working", id, async (agent) => {
    // The project is optional: the bid names its issue. When given, it must be one this key may use.
    if (request.nextUrl.searchParams.get("projectId")) await issueProject(agent, request.nextUrl.searchParams);
    const awarded = await awardBid(agent, id);
    // #plan-review: on a complex issue the award opens plan review (`planning`, with `planBy`) instead of an offer.
    return NextResponse.json({ bidId: awarded.bidId, claimId: awarded.claimId, bugId: awarded.bugId, status: awarded.status, ...(awarded.planBy ? { planBy: awarded.planBy } : {}) }, { status: 200 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
