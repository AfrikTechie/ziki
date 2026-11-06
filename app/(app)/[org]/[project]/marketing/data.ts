import "server-only";
import type { Prisma, Status } from "@prisma/client";
import type { IdeaListRow } from "@/components/ideas-list";
import { TASK_TABS, type TaskRow, type TasksBoardData, type TaskView } from "@/components/marketing/tasks/model";
import { duplicatesWhere } from "@/lib/duplicates";
import { ideaVotes, isBadIdea } from "@/lib/idea-rejection";
import { ideaVoteTotals, NO_VOTES } from "@/lib/idea-vote-totals";
import { issueHref } from "@/lib/issue-ref";
import { getBugOrderBy } from "@/lib/issues-sort";
import { getIdeaOrderBy } from "@/lib/list-sort";
import { MARKETING_TRACK } from "@/lib/marketing/track";
import { OPEN_BID_WHERE } from "@/lib/open-bids";
import { calculatePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import type { ProjectContext } from "@/lib/project-route";
import { workflowFor } from "@/lib/workflow";

/**
 * Where delivered work rests. A claim can be released after delivering, so the
 * delivery says who did it. Work reopened for bids isn't here: its last worker
 * has no part in it any more.
 */
const DELIVERED_STATUSES: Status[] = ["done", "resolved", "closed"];

/** The caller must resolve access with requireProject; every read stays in that organisation and project. */
export async function readTasksBoard({ project, organisationId, user }: ProjectContext, view: TaskView): Promise<TasksBoardData> {
  const issueScope: Prisma.BugWhereInput = {
    organisationId,
    projectId: project.id,
    isDeleted: false,
    ...MARKETING_TRACK,
    ...duplicatesWhere(false),
  };
  const proposalScope: Prisma.IdeaWhereInput = {
    organisationId,
    projectId: project.id,
    isDeleted: false,
    ...MARKETING_TRACK,
    status: "open",
  };

  const [grouped, proposed, workflow] = await Promise.all([
    prisma.bug.groupBy({ by: ["status"], where: issueScope, _count: { _all: true } }),
    prisma.idea.count({ where: proposalScope }),
    workflowFor(project.id),
  ]);
  const counts = Object.fromEntries(TASK_TABS.map((tab) => [
    tab.param,
    tab.status === null ? proposed : (grouped.find((row) => row.status === tab.status)?._count._all ?? 0),
  ])) as TasksBoardData["counts"];

  const { tab } = view;
  const pagination = calculatePagination({ page: view.page ?? undefined, totalCount: counts[tab.param] });
  const paging = { skip: pagination.skip, take: pagination.take };

  let list: TasksBoardData["list"];
  if (tab.status === null) {
    const threshold = workflow.ideaThreshold;
    const rows = await prisma.idea.findMany({
      where: proposalScope,
      orderBy: getIdeaOrderBy(view.proposalSort),
      ...paging,
      select: {
        id: true, number: true, title: true, score: true, createdAt: true, updatedAt: true,
        // Its newest verdict, for the Last update column.
        verdicts: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
        reporter: { select: { name: true } },
        _count: { select: { verdicts: true } },
      },
    });
    const ids = rows.map((row) => row.id);
    const [totals, mine] = await Promise.all([
      ideaVoteTotals(prisma, ids),
      prisma.ideaVerdict.findMany({ where: { ideaId: { in: ids }, onBehalfOfUserId: user.id }, select: { ideaId: true } }),
    ]);
    const approvedByMe = new Set(mine.map((verdict) => verdict.ideaId));
    const ideas: IdeaListRow[] = rows.map((row) => {
      const votes = totals.get(row.id) ?? NO_VOTES;
      const newestVerdict = row.verdicts[0]?.updatedAt;
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        score: row.score,
        threshold,
        createdAt: row.createdAt,
        reporterName: row.reporter.name,
        verdicts: row._count.verdicts,
        good: votes.good,
        badVotes: votes.bad,
        bad: isBadIdea(ideaVotes([{ opinion: "good", votes: votes.good }, { opinion: "bad", votes: votes.bad }, { opinion: "neutral", votes: votes.neutral }]), threshold),
        approvedByMe: approvedByMe.has(row.id),
        lastUpdateAt: newestVerdict && newestVerdict > row.updatedAt ? newestVerdict : row.updatedAt,
      };
    });
    list = { kind: "proposals", ideas, sort: view.proposalSort };
  } else {
    const tasks = await prisma.bug.findMany({
      where: { ...issueScope, status: tab.status },
      orderBy: getBugOrderBy(view.taskSort),
      ...paging,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        substatus: true,
        closeReason: true,
        voteCount: true,
        revisionCount: true,
        updatedAt: true,
        reward: true,
        rewardEstimateCount: true,
        rewardFixedAt: true,
        project: { select: { slug: true, organisation: { select: { slug: true } } } },
        type: { select: { name: true } },
        assignee: { select: { name: true } },
        // The claim working on it, or an offer waiting to be accepted.
        claims: {
          where: { status: { in: ["active", "offered"] }, releasedAt: null },
          orderBy: { createdAt: "desc" },
          take: 2,
          select: { status: true, claimedAt: true, createdAt: true, agent: { select: { name: true } }, beneficiary: { select: { name: true } } },
        },
        deliveries: { orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 1, select: { agent: { select: { name: true } } } },
        _count: { select: { comments: true, bids: { where: OPEN_BID_WHERE } } },
      },
    });
    const rows: TaskRow[] = tasks.map((task) => {
      const active = task.claims.find((claim) => claim.status === "active");
      const offer = task.claims.find((claim) => claim.status === "offered");
      const deliverer = DELIVERED_STATUSES.includes(task.status) ? task.deliveries[0]?.agent.name : null;
      return {
        id: task.id,
        number: task.number,
        title: task.title,
        href: issueHref(task),
        status: task.status,
        substatus: task.substatus,
        closeReason: task.closeReason,
        importance: task.voteCount,
        reward: Number(task.reward),
        rewardEstimates: task.rewardEstimateCount,
        rewardFixed: Boolean(task.rewardFixedAt),
        typeName: task.type?.name ?? null,
        agentName: active?.agent.name ?? offer?.agent.name ?? deliverer ?? null,
        work: active || task.status === "in_progress"
          ? { person: active?.beneficiary.name ?? task.assignee?.name ?? null, since: active ? (active.claimedAt ?? active.createdAt) : null }
          : null,
        offeredTo: task.substatus === "open" && offer ? (offer.beneficiary.name ?? "someone") : null,
        revision: task.status === "in_progress" && task.revisionCount > 0 ? `Revision ${task.revisionCount} of ${workflow.revisionLimit}` : null,
        bids: task._count.bids,
        comments: task._count.comments,
        updatedAt: task.updatedAt,
      };
    });
    list = { kind: "tasks", rows, sort: view.taskSort };
  }

  return {
    tab,
    counts,
    sortParam: view.sortParam,
    list,
    pagination: {
      page: pagination.page,
      totalPages: pagination.totalPages,
      totalCount: pagination.totalCount,
      from: pagination.from,
      to: pagination.to,
    },
  };
}
