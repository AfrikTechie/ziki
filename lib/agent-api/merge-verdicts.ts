import { reviewerConflict, type ReviewedBug } from "@/lib/agents/independence";
import { levelIn } from "@/lib/agents/active-in";
import type { AgentLevel } from "@prisma/client";

/** A judgement, with its agent's activations (`activeLevels`): its class is the one in the issue's organisation (#user-agents). */
export type CountableVerdict = {
  headSha?: string | null;
  onBehalfOfUserId: string;
  agent: { id: string; ownerUserId: string; activations: { organisationId: string; level: AgentLevel }[] };
};

/**
 * What a good-to-merge (or not) verdict counts toward `verdictsNeeded`
 * (#owner-agents): a manager or merger agent's 2, a working agent's 1. A
 * person counts once per class, so one owner with a manager agent and a
 * working agent can give 3.
 */
export const MANAGER_VERDICT_WEIGHT = 2;

/** The class a judgement counts in: a manager or merger agent's, or a working agent's. */
export type VerdictClass = "manager" | "working";

export function verdictClass(level: string | null | undefined): VerdictClass {
  return level === "manager" || level === "merger" ? "manager" : "working";
}

export type VerdictClaim = { agentId: string; agent: { ownerUserId: string } } | null;

type ClaimRow = { status: string; claimedAt?: Date | null; releasedAt: Date | null };

/**
 * The claim the fix was delivered under (#432): the active one, or, once a
 * pull request is linked, the last claim let go after delivery. A delivered fix
 * stays where it got to when its agent lets go (#one-status), so its testing,
 * review, merge and points still follow that claim. Pass claims with
 * `claimedAt` selected.
 */
export function deliveredClaim<C extends ClaimRow>(bug: { pullRequestUrl: string | null; claims: readonly C[] }): C | null {
  const active = bug.claims.find((c) => c.status === "active" && !c.releasedAt);
  if (active || !bug.pullRequestUrl) return active ?? null;
  const released = bug.claims
    .filter((c) => c.status === "released" && c.claimedAt && c.releasedAt)
    .sort((a, b) => b.releasedAt!.getTime() - a.releasedAt!.getTime());
  return released[0] ?? null;
}

/**
 * The verdicts that count toward a fix (#434, #owner-agents), and their
 * weight: one per person per class (a manager or merger agent's counts
 * `MANAGER_VERDICT_WEIGHT`, a working agent's 1), never from the agent holding
 * the claim, which can't judge its own work. The owner's other agents count:
 * nothing is gated to other people. The merge gate and the merge queue both
 * use this, so a fix the queue lists as ready is one the gate accepts. Pass
 * only verdicts on the linked pull request (#526), oldest first: the last
 * counted one names the commit that may merge (#489). `reviewers` are the
 * people, once each, for the reviewer points.
 */
export function countedMergeVerdicts(
  verdicts: readonly CountableVerdict[],
  claim: VerdictClaim,
  reviewed: ReviewedBug,
  organisationId: string,
  fallbackHeadSha: string | null = null,
): { reviewers: string[]; weight: number; acceptedHeadSha: string | null } {
  const seen = new Set<string>();
  const reviewers: string[] = [];
  let weight = 0;
  let acceptedHeadSha = fallbackHeadSha;
  for (const verdict of verdicts) {
    if (claim && verdict.agent.id === claim.agentId) continue;
    if (reviewerConflict({ id: verdict.agent.id, ownerUserId: verdict.agent.ownerUserId }, reviewed)) continue;
    const kind = verdictClass(levelIn(verdict.agent, organisationId));
    const key = `${verdict.onBehalfOfUserId}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    weight += kind === "manager" ? MANAGER_VERDICT_WEIGHT : 1;
    if (!reviewers.includes(verdict.onBehalfOfUserId)) reviewers.push(verdict.onBehalfOfUserId);
    if (verdict.headSha) acceptedHeadSha = verdict.headSha;
  }
  return { reviewers, weight, acceptedHeadSha };
}
