import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOrganisationAdminRole } from "@/lib/agents/membership";
import type { AppRole } from "@/lib/roles";
import { auditAccess, auditWhere } from "@/lib/agent-audit/visibility";
import { activeIn } from "@/lib/agents/active-in";
import { parseEscalationBody } from "@/lib/agent-questions";
import { holdLoad } from "@/lib/agent-api/capacity";
import { workflowFor } from "@/lib/workflow";
import { issueHref } from "@/lib/issue-ref";
import type { ActivityClaim, ActivityData, ActivityIssue, ActivitySlots } from "@/lib/activity/board";

/**
 * Everything the Activity page shows (#849), for one signed-in person in their
 * current organisation. Organisation owners and admins see every agent's
 * work; everyone else sees their own agents. Questions (escalations) are
 * always the person's own, as in the Inbox. Each list is capped: the page
 * shows them 20 at a time with "Show more".
 */

/** How many rows each list loads. */
export const ACTIVITY_LOAD_LIMIT = 100;

const issueSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  substatus: true,
  pullRequestUrl: true,
  projectId: true,
  project: { select: { slug: true, name: true, organisation: { select: { slug: true } } } },
} as const;

const claimSelect = {
  id: true,
  status: true,
  offeredAt: true,
  claimedAt: true,
  deliverBy: true,
  lastHeartbeatAt: true,
  waitingOnOwnerSince: true,
  releasedAt: true,
  releaseReason: true,
  createdAt: true,
  agent: { select: { id: true, name: true } },
  bug: { select: issueSelect },
} as const;

type IssueRow = Prisma.BugGetPayload<{ select: typeof issueSelect }>;
type ClaimRow = Prisma.IssueClaimGetPayload<{ select: typeof claimSelect }>;

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function toIssue(bug: IssueRow): ActivityIssue {
  return {
    id: bug.id,
    number: bug.number,
    title: bug.title,
    status: bug.status,
    substatus: bug.substatus,
    pullRequestUrl: bug.pullRequestUrl,
    href: issueHref(bug),
  };
}

export async function loadActivity(
  userId: string,
  organisationId: string,
  options: { issueNumber?: number | null; appRole?: AppRole | null } = {},
): Promise<(ActivityData & { isAdmin: boolean; loadedAt: number }) | null> {
  const member = await prisma.membership.findUnique({
    where: { organisationId_userId: { organisationId, userId } },
    select: { role: true },
  });
  if (!member) return null;
  const isAdmin = isOrganisationAdminRole(member.role, options.appRole);

  const agents = await prisma.agent.findMany({
    where: { ...activeIn(organisationId), revokedAt: null, ...(isAdmin ? {} : { ownerUserId: userId }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const agentIds = agents.map((agent) => agent.id);
  const loadedAt = Date.now();
  const empty = { agents, claims: [], questions: [], events: [], slots: [], isAdmin, loadedAt };
  // An issue filter that isn't a number matches nothing, never everything.
  if (options.issueNumber === null || (!agentIds.length && !isAdmin)) return empty;

  const bug: Prisma.BugWhereInput = {
    organisationId,
    isDeleted: false,
    ...(options.issueNumber !== undefined ? { number: options.issueNumber } : {}),
  };
  // The issue scope already keeps claims in this organisation; a member sees their own agents' claims.
  const agentScope: Prisma.AgentWhereInput = isAdmin ? {} : { ownerUserId: userId };
  const access = auditAccess({ isAdminOfOrganisation: isAdmin, organisationId, ownedAgentIds: agentIds });

  const [openClaims, releasedClaims, questions, events] = await Promise.all([
    prisma.issueClaim.findMany({
      where: { releasedAt: null, agent: agentScope, bug },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LOAD_LIMIT,
      select: claimSelect,
    }),
    prisma.issueClaim.findMany({
      where: { releasedAt: { not: null }, agent: agentScope, bug },
      orderBy: [{ releasedAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LOAD_LIMIT,
      select: claimSelect,
    }),
    // Even admins only read their own questions, as in the Inbox. Unanswered only.
    prisma.agentQuestion.findMany({
      where: {
        ownerUserId: userId,
        answeredAt: null,
        agent: activeIn(organisationId),
        ...(options.issueNumber !== undefined ? { bug } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LOAD_LIMIT,
      select: { id: true, body: true, createdAt: true, agent: { select: { id: true, name: true } }, bug: { select: issueSelect } },
    }),
    access.kind === "forbidden"
      ? Promise.resolve([])
      : prisma.agentAuditEvent.findMany({
          where: {
            AND: [
              auditWhere(access),
              options.issueNumber !== undefined ? { bug } : { OR: [{ bugId: null }, { bug }] },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: ACTIVITY_LOAD_LIMIT,
          // Summary only: private question and message text can be in the payload.
          select: { id: true, createdAt: true, action: true, undoneAt: true, agent: { select: { id: true, name: true } }, bug: { select: issueSelect } },
        }),
  ]);

  // History for delivered issues: every claim on them, not just the latest.
  const deliveredIds = openClaims.filter((claim) => claim.bug.status === "done" || claim.bug.status === "merge").map((claim) => claim.bug.id);
  const seen = new Set([...openClaims, ...releasedClaims].map((claim) => claim.id));
  const history = deliveredIds.length
    ? await prisma.issueClaim.findMany({
        where: { bugId: { in: deliveredIds }, agent: agentScope, id: { notIn: [...seen] } },
        orderBy: [{ createdAt: "asc" }],
        take: ACTIVITY_LOAD_LIMIT,
        select: claimSelect,
      })
    : [];
  const claimRows: ClaimRow[] = [...openClaims, ...releasedClaims, ...history];

  // Offer and delivery windows, and the person's own claim slots, per project.
  const projectIds = [...new Set(claimRows.map((claim) => claim.bug.projectId))];
  const workflows = new Map(await Promise.all(projectIds.map(async (id) => [id, await workflowFor(id)] as const)));
  const openProjects = [...new Set(openClaims.map((claim) => claim.bug.projectId))];
  const slots: ActivitySlots[] = await Promise.all(
    openProjects.map(async (projectId) => {
      const workflow = workflows.get(projectId)!;
      const name = openClaims.find((claim) => claim.bug.projectId === projectId)!.bug.project.name;
      const used = await holdLoad(prisma, { organisationId, projectId, userId }, workflow.offerWindowSeconds);
      return { project: name, used, max: workflow.maxActiveClaims };
    }),
  );

  const claims: ActivityClaim[] = claimRows.map((claim) => {
    const workflow = workflows.get(claim.bug.projectId)!;
    return {
      id: claim.id,
      status: claim.status,
      agent: claim.agent,
      issue: toIssue(claim.bug),
      offeredAt: iso(claim.offeredAt),
      claimedAt: iso(claim.claimedAt),
      deliverBy: iso(claim.deliverBy),
      lastHeartbeatAt: iso(claim.lastHeartbeatAt),
      waitingOnOwnerSince: iso(claim.waitingOnOwnerSince),
      releasedAt: iso(claim.releasedAt),
      releaseReason: claim.releaseReason,
      createdAt: claim.createdAt.toISOString(),
      offerWindowSeconds: workflow.offerWindowSeconds,
      deliveryMinutes: workflow.deliveryMinutes,
    };
  });

  return {
    isAdmin,
    loadedAt,
    agents,
    claims,
    questions: questions.map((question) => ({
      id: question.id,
      agent: question.agent,
      issue: question.bug ? toIssue(question.bug) : null,
      body: parseEscalationBody(question.body).cleanBody,
      createdAt: question.createdAt.toISOString(),
      href: `/inbox/escalations/${question.id}`,
    })),
    events: events.map((event) => ({
      id: event.id,
      agent: event.agent,
      action: event.action,
      createdAt: event.createdAt.toISOString(),
      undone: Boolean(event.undoneAt),
      issue: event.bug ? toIssue(event.bug) : null,
    })),
    slots,
  };
}
