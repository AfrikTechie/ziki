"use server";

import { requireUser } from "@/lib/auth-helpers";
import { activeLevels, isActiveIn, levelIn } from "@/lib/agents/active-in";
import { prisma } from "@/lib/prisma";
import { awardBid, placeBid } from "@/lib/agent-api/bid";
import { ENTRY_DESCRIPTION_MAX_CHARS } from "@/lib/agent-api/entry-fields";
import { IssueApiError } from "@/lib/agent-api/errors";
import { awardingAgentOf } from "@/lib/bid-award-permission";
import { revalidateIssue } from "@/lib/revalidate-issue";
import { checkPostForSecrets } from "@/lib/security/secret-guard";

export type AwardBidResult = { ok: true } | { ok: false; error: string };
export type PlaceBidResult = { ok: true } | { ok: false; error: string };

/**
 * A person bids from the issue page in one click: one of their own agents
 * places the bid, under the same rules as `POST /api/v1/issues/{id}/bids`
 * (the issue is open, nobody holds it, one bid per agent). The optional
 * comment becomes the bid's description; without one, it says the agent
 * will share its plan when it picks the issue up.
 */
export async function placeIssueBidAction(formData: FormData): Promise<PlaceBidResult> {
  const user = await requireUser();
  const bugId = String(formData.get("bugId") ?? "");
  const agentId = String(formData.get("agentId") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!bugId) return { ok: false, error: "That issue no longer exists." };
  if (!agentId) return { ok: false, error: "Choose an agent to bid with." };
  if (comment.length > ENTRY_DESCRIPTION_MAX_CHARS) return { ok: false, error: "That comment is too long." };

  const bug = await prisma.bug.findFirst({
    where: { id: bugId, isDeleted: false },
    select: { id: true, projectId: true, organisationId: true },
  });
  if (!bug?.projectId) return { ok: false, error: "That issue no longer exists." };
  // #secret-protection: the comment is the bid's description, read by everyone on the issue.
  const secrets = await checkPostForSecrets({
    organisationId: bug.organisationId,
    projectId: bug.projectId,
    actor: { kind: "user", userId: user.id },
    source: "bid",
    bugId: bug.id,
    fields: { comment },
    noun: "this bid",
  });
  if (!secrets.ok) return { ok: false, error: secrets.message };
  const row = await prisma.agent.findFirst({
    where: { id: agentId, ownerUserId: user.id, revokedAt: null },
    select: { id: true, name: true, ownerUserId: true, activations: activeLevels },
  });
  if (!row) return { ok: false, error: "You can only bid with one of your own agents." };
  // #user-agents: it bids where it is active.
  if (!isActiveIn(row, bug.organisationId)) return { ok: false, error: `${row.name} isn't active in this organisation. Activate it under the organisation's Agents settings.` };
  const agent = { id: row.id, name: row.name, ownerUserId: row.ownerUserId, organisationId: bug.organisationId, level: levelIn(row, bug.organisationId) };

  try {
    await placeBid(
      { agentId: agent.id, name: agent.name, ownerId: agent.ownerUserId, organisationId: agent.organisationId, level: agent.level, burst: false, keyId: "web" },
      bug.projectId,
      bug.id,
      {
        summary: `${agent.name} bids to take this on.`,
        description: comment || `Placed from the issue page. ${agent.name} will share its plan when it picks this up.`,
      },
    );
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[bids] place failed", error);
    return { ok: false, error: "Could not place that bid." };
  }
}

/**
 * A person who owns an agent in the organisation awards a bid from the issue
 * page (#award-bids). It is their highest-level agent's award, under the same
 * rules as `POST /api/v1/bids/{id}/award`: the bid's votes must have reached
 * the project's awardThreshold, and the award is an offer the bidding agent
 * accepts.
 */
export async function awardIssueBidAction(
  _previous: AwardBidResult | undefined,
  formData: FormData,
): Promise<AwardBidResult> {
  const user = await requireUser();
  const bidId = String(formData.get("bidId") ?? "");
  if (!bidId) return { ok: false, error: "Choose a bid." };
  const bid = await prisma.issueBid.findUnique({ where: { id: bidId }, select: { bug: { select: { organisationId: true } } } });
  if (!bid) return { ok: false, error: "That bid no longer exists." };
  const agent = await awardingAgentOf(user.id, bid.bug.organisationId);
  if (!agent) return { ok: false, error: "Only people who own an agent in this organisation can award bids." };
  try {
    await awardBid(
      {
        agentId: agent.id,
        name: agent.name,
        ownerId: agent.ownerUserId,
        organisationId: agent.organisationId,
        level: agent.level,
        burst: false,
        keyId: "web",
      },
      bidId,
    );
    revalidateIssue();
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { ok: false, error: error.message };
    console.error("[bids] award failed", error);
    return { ok: false, error: "Could not award that bid." };
  }
}
