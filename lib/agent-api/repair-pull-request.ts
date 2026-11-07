import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PRODUCT_STEP_ONLY_MESSAGE, trackRules } from "@/lib/marketing/track";
import type { AgentContext } from "@/lib/agents/require-agent";
import { hasLevel } from "@/lib/agents/levels";
import { audit } from "@/lib/agents/audit";
import { reviewerConflict, ReviewerNotIndependentError } from "@/lib/agents/independence";
import { publish } from "@/lib/agent-api/events";
import { parseIssueRef } from "@/lib/issue-ref";
import { isFormerNameOf } from "@/lib/github/former-repos";
import { parsePullRequestUrl, sameRepo } from "@/lib/github/pull-request-url";
import { PROJECT_REPOSITORIES_SELECT, projectRepoRefs, repoForPullRequest } from "@/lib/github/project-repositories";
import { standingAcceptance } from "@/lib/accepted-fix";
import { latestPullRequestReport } from "@/lib/agent-api/pull-request-report";

/**
 * Repairing or updating a pull request link (#repair-pr-link, #edit-pr-link).
 *
 * Some issues link a pull request under a name the repository no longer has
 * (it was renamed from Zedu-Endor/issue-tracker and zeduchat/bug-tracker to
 * emerjent/ziki), and some links are reported missing on GitHub or need to be
 * replaced by the contributor who submitted them (for example after closing and
 * reopening a PR, rebasing onto a new branch, or fixing a typo). The
 * contributor holding or assigned to the issue (or who delivered its pull
 * request), or an independent manager agent, replaces the link with a pull
 * request in the project's repository, told from its URL: the one it names, or,
 * when it names none, the same number in the project's repository. Ziki never
 * asks GitHub (#pr-reports); the new link has no report unless an independent
 * agent already reported it, so an independent agent checks it on GitHub and
 * reports it before anything that needs its state.
 *
 * Judgements (`TestVerdict`) and merge reviews count only on the linked pull
 * request. When the new link is the same pull request moved (the old link's
 * repository is a former name of this one, `FORMER_REPOSITORY_NAMES`, or this
 * repository, and the number is the same), they, the delivery and any review
 * offers move with it and keep counting. When it is a different pull request,
 * judgements and merge reviews stay on the old address and stop counting:
 * nobody judged the new code.
 */

export const repairPullRequestSchema = z
  .object({
    /** The pull request to link. Defaults to the old link's number in the project's repository. */
    pullRequestUrl: z.string().trim().min(1).max(2048).optional(),
    projectId: z.string().trim().min(1).max(191).optional(),
  })
  .strict();

export type RepairPullRequestInput = z.infer<typeof repairPullRequestSchema>;

export type RepairError =
  | "insufficient_level"
  | "invalid_url"
  | "not_found"
  | "not_independent"
  | "no_pull_request"
  | "no_repo"
  | "wrong_repository"
  | "already_current"
  | "status_changed"
  | "wrong_track";

export type RepairResult =
  | {
      status: 200;
      body: {
        repaired: true;
        issueId: string;
        previousPullRequestUrl: string;
        pullRequestUrl: string;
        pullRequestHeadSha: string | null;
        /** True when it is the same pull request under the repository's current name. */
        samePullRequest: boolean;
        /** Entries moved to the new address with it (zero for a different pull request). */
        moved: { judgements: number; mergeReviews: number; deliveries: number; reviewOffers: number };
      };
    }
  | { status: 403 | 404 | 409 | 422; body: { error: RepairError; message: string } };

const fail = (status: 403 | 404 | 409 | 422, error: RepairError, message: string): RepairResult =>
  ({ status, body: { error, message } });

/** Replace issue `issueRef`'s linked pull request with one in the project's repository. */
export async function repairPullRequestLink(
  agent: AgentContext,
  scope: { organisationId: string; projectId: string },
  issueRef: string,
  input: Omit<RepairPullRequestInput, "projectId">,
): Promise<RepairResult> {
  const named = input.pullRequestUrl === undefined ? null : parsePullRequestUrl(input.pullRequestUrl);
  if (input.pullRequestUrl !== undefined && !named) return fail(422, "invalid_url", "That is not a GitHub pull request URL.");

  const ref = parseIssueRef(issueRef);
  const bug = await prisma.bug.findFirst({
    where: { ...scope, isDeleted: false, ...(ref.kind === "number" ? { number: ref.number } : { id: ref.id }) },
    select: {
      id: true,
      status: true,
      track: true,
      pullRequestUrl: true,
      pullRequestHeadSha: true,
      proofLinks: true,
      reporterId: true,
      beneficiaryUserId: true,
      assigneeId: true,
      createdByAgent: { select: { ownerUserId: true } },
      project: { select: { repoUrl: true, ...PROJECT_REPOSITORIES_SELECT } },
      claims: {
        select: { status: true, releasedAt: true, beneficiaryUserId: true, agentId: true, dispatcherUserId: true, agent: { select: { ownerUserId: true } } },
      },
      deliveries: {
        select: { id: true, pullRequestUrl: true, agentId: true, beneficiaryUserId: true, agent: { select: { ownerUserId: true } } },
      },
    },
  });
  if (!bug) return fail(404, "not_found", "No such issue in this project.");
  if (!trackRules(bug.track).hasProductSteps) return fail(409, "wrong_track", PRODUCT_STEP_ONLY_MESSAGE);

  const activeClaim = bug.claims?.find(
    (c) => !c.releasedAt && (c.status === "active" || c.status === "offered"),
  );
  const holdsActiveClaim = Boolean(
    activeClaim &&
      (activeClaim.agentId === agent.agentId ||
        activeClaim.beneficiaryUserId === agent.ownerId ||
        activeClaim.agent?.ownerUserId === agent.ownerId),
  );
  const currentDelivery = bug.pullRequestUrl
    ? bug.deliveries?.find((d) => d.pullRequestUrl === bug.pullRequestUrl)
    : null;
  const deliveredCurrent = Boolean(
    currentDelivery &&
      (currentDelivery.agentId === agent.agentId ||
        currentDelivery.beneficiaryUserId === agent.ownerId ||
        currentDelivery.agent?.ownerUserId === agent.ownerId),
  );
  const isAssignee = Boolean(bug.assigneeId && bug.assigneeId === agent.ownerId);

  // An actor owns the current contribution if they hold the active claim, or,
  // when no active claim exists, if they are the current assignee or delivered
  // the currently linked pull request. A former deliverer whose delivery was
  // for an earlier pull request or who lost their claim is refused once another
  // contributor owns the work.
  const isContributor =
    holdsActiveClaim || (!activeClaim && (isAssignee || deliveredCurrent));

  if (!isContributor) {
    if (!hasLevel(agent.level, "manager")) {
      return fail(403, "insufficient_level", "Only a manager or merger agent, or the contributor who submitted the pull request, can repair or update a pull request link.");
    }
    const conflict = reviewerConflict({ id: agent.agentId, ownerUserId: agent.ownerId }, bug);
    if (conflict) return fail(403, "not_independent", new ReviewerNotIndependentError(conflict).message);
  } else if (!hasLevel(agent.level, "manager") && (bug.status === "resolved" || bug.status === "closed")) {
    return fail(409, "status_changed", "A resolved or closed issue's pull request link can't be replaced by the contributor.");
  }

  const previous = bug.pullRequestUrl;
  if (!previous) return fail(409, "no_pull_request", "This issue has no linked pull request to repair.");

  // With no address named, the same number is looked for in the main repository.
  const repo = repoForPullRequest(bug.project, null);
  if (!repo) return fail(422, "no_repo", "This project has no GitHub repository set, so a pull request link can't be checked against it.");

  const old = parsePullRequestUrl(previous);
  const target = named ?? (old ? { owner: repo.owner, repo: repo.repo, number: old.number } : null);
  if (!target) {
    return fail(422, "invalid_url", "The linked address is not a GitHub pull request. Name the pull request to link (pullRequestUrl).");
  }
  // The repository it is in: the main one or any the project lists (#2).
  const targetRepo = projectRepoRefs(bug.project).find((candidate) => sameRepo(target, candidate));
  if (!targetRepo) return fail(422, "wrong_repository", "That pull request is not in this project's repository.");

  // The canonical address: the project's own spelling of its repository.
  const next = `https://github.com/${targetRepo.owner}/${targetRepo.repo}/pull/${target.number}`;
  if (next === previous) return fail(409, "already_current", "The issue already links that pull request.");

  // The same pull request moved: same number, under a former name of this
  // repository (or this one, spelled differently).
  const samePullRequest = Boolean(old && old.number === target.number && (sameRepo(old, targetRepo) || isFormerNameOf(old, targetRepo)));

  if (!samePullRequest && prisma.agentAuditEvent) {
    const accepted = await standingAcceptance(prisma, bug.id);
    if (accepted) {
      return fail(409, "status_changed", "This issue's accepted fix is bound to a different pull request — link the accepted one again.");
    }
  }

  // The same pull request keeps the head its judgements were given on; a
  // different one refreshes from the latest report on the new link, or null
  // until someone reports it.
  const latestReport = !samePullRequest && prisma.pullRequestReport ? await latestPullRequestReport(bug.id, next) : null;
  const headSha = samePullRequest ? bug.pullRequestHeadSha : (latestReport?.headSha ?? null);
  const nextProofLinks =
    Array.isArray(bug.proofLinks) && bug.proofLinks.includes(previous)
      ? [...new Set(bug.proofLinks.map((link) => (link === previous ? next : link)))]
      : undefined;

  const moved = await prisma.$transaction(async (tx) => {
    // Only from the link read above: someone may have linked another since.
    const changed = await tx.bug.updateMany({
      where: { id: bug.id, pullRequestUrl: previous },
      data: {
        pullRequestUrl: next,
        pullRequestHeadSha: headSha,
        ...(nextProofLinks ? { proofLinks: nextProofLinks } : {}),
      },
    });
    if (changed.count !== 1) return null;
    const counts = { judgements: 0, mergeReviews: 0, deliveries: 0, reviewOffers: 0 };
    if (samePullRequest) {
      const where = { bugId: bug.id, pullRequestUrl: previous };
      const data = { pullRequestUrl: next };
      counts.judgements = (await tx.testVerdict.updateMany({ where, data })).count;
      counts.mergeReviews = (await tx.mergeReview.updateMany({ where, data })).count;
      counts.deliveries = (await tx.delivery.updateMany({ where, data })).count;
      counts.reviewOffers = (await tx.reviewOffer.updateMany({ where, data })).count;
    } else if (isContributor && tx.delivery) {
      counts.deliveries = (
        await tx.delivery.updateMany({
          where: {
            bugId: bug.id,
            pullRequestUrl: previous,
            OR: [
              { agentId: agent.agentId },
              { beneficiaryUserId: agent.ownerId },
              { agent: { ownerUserId: agent.ownerId } },
            ],
          },
          data: { pullRequestUrl: next, headSha },
        })
      ).count;
    }
    await audit(
      agent,
      "issue.pull_request_repaired",
      `bug:${bug.id}`,
      { from: previous, to: next, samePullRequest, headSha, moved: counts },
      { bugId: bug.id, db: tx },
    );
    await publish(tx, {
      organisationId: scope.organisationId,
      type: "issue.updated",
      actorAgentId: agent.agentId,
      bugId: bug.id,
      payload: {
        issueId: bug.id,
        projectId: scope.projectId,
        changed: ["pullRequestUrl"],
        values: { pullRequestUrl: next },
        previousPullRequestUrl: previous,
        samePullRequest,
        source: "agent",
        agentId: agent.agentId,
      },
    });
    return counts;
  });
  if (!moved) return fail(409, "status_changed", "The issue's linked pull request changed while the request ran. Read it again and retry.");

  return {
    status: 200,
    body: {
      repaired: true,
      issueId: bug.id,
      previousPullRequestUrl: previous,
      pullRequestUrl: next,
      pullRequestHeadSha: headSha,
      samePullRequest,
      moved,
    },
  };
}
