import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/agent-api/events";
import { statusChangedSummary } from "@/lib/activity-log";
import { parsePullRequestUrl } from "@/lib/github/pull-request-url";
import { issuePath } from "@/lib/issue-ref";
import { moveTo } from "@/lib/issue-substatus";
import { projectRef } from "@/lib/project-paths";
import { isOrganisationAdmin, type OrganisationRole } from "@/lib/organisation-role";
import type { AppRole } from "@/lib/roles";
import {
  REVERT_OF_FIELD,
  TAKE_IT_BACK_FIELD,
  reopenedFromRevert,
  revertDescription,
  revertMessage,
  revertTitle,
  takeItBackReasonError,
  takeItBackState,
  takeItBackWindowEndsAt,
  type ExistingRevert,
  type TakeItBackView,
} from "@/lib/take-it-back";

type ViewIssue = {
  id: string;
  number: number;
  title: string;
  status: string;
  isDeleted: boolean;
  organisationId: string;
  pullRequestUrl: string | null;
  updatedAt: Date;
};

type ReadResult = {
  mergedAt: Date | null;
  mergeCommitSha: string | null;
  mergedInto: string | null;
  existing: ExistingRevert | null;
};

function metadataOf(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** When the issue last became Live, with the merge facts when a report has them. */
async function readMerge(tx: Prisma.TransactionClient, issue: ViewIssue): Promise<ReadResult> {
  const [liveMove, report, request] = await Promise.all([
    tx.bugActivity.findFirst({
      where: { bugId: issue.id, type: "status_changed", metadata: { path: ["to"], equals: "on_dev" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    issue.pullRequestUrl
      ? tx.pullRequestReport.findFirst({
          where: { bugId: issue.id, pullRequestUrl: issue.pullRequestUrl, state: "merged" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, mergedInto: true, mergeCommitSha: true },
        })
      : Promise.resolve(null),
    tx.bugActivity.findFirst({
      where: { bugId: issue.id, type: "created", metadata: { path: ["field"], equals: TAKE_IT_BACK_FIELD } },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    }),
  ]);

  let existing: ExistingRevert | null = null;
  const requestMeta = metadataOf(request?.metadata ?? null);
  const revertIssueId = typeof requestMeta?.revertIssueId === "string" ? requestMeta.revertIssueId : null;
  if (revertIssueId) {
    const revert = await tx.bug.findFirst({
      where: { id: revertIssueId, isDeleted: false },
      select: { id: true, number: true, status: true, substatus: true },
    });
    if (revert) existing = revert;
  }

  return {
    mergedAt: liveMove?.createdAt ?? report?.createdAt ?? issue.updatedAt,
    mergeCommitSha: report?.mergeCommitSha ?? null,
    mergedInto: report?.mergedInto ?? null,
    existing,
  };
}

/**
 * What the issue page shows an owner or admin beside Status. Returns null for
 * everyone else, and for issues that are not merged.
 */
export async function takeItBackViewFor(input: {
  issue: ViewIssue;
  membershipRole: OrganisationRole | null | undefined;
  appRole?: AppRole | null;
  now?: Date;
}): Promise<TakeItBackView | null> {
  const { issue, membershipRole, appRole } = input;
  if (issue.isDeleted || issue.status !== "resolved") return null;
  if (!isOrganisationAdmin(membershipRole, appRole)) return null;

  const read = await prisma.$transaction((tx) => readMerge(tx, issue));
  const state = takeItBackState({
    status: issue.status,
    isDeleted: issue.isDeleted,
    membershipRole,
    appRole,
    mergedAt: read.mergedAt,
    existing: read.existing,
    now: input.now,
  });
  if (state.kind === "not_allowed" || state.kind === "not_merged") return null;

  const pull = parsePullRequestUrl(issue.pullRequestUrl);
  return {
    state: state.kind,
    issueId: issue.id,
    issueNumber: issue.number,
    title: issue.title,
    mergedAt: read.mergedAt?.toISOString() ?? null,
    endsAt: read.mergedAt ? takeItBackWindowEndsAt(read.mergedAt).toISOString() : null,
    pullRequestUrl: issue.pullRequestUrl,
    filesUrl: pull
      ? `https://api.github.com/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}/files?per_page=100`
      : null,
    mergeCommitSha: read.mergeCommitSha,
    mergedInto: read.mergedInto,
    existing: state.kind === "already_requested"
      ? { number: state.revert.number, message: state.message }
      : null,
  };
}

export type CreateTakeItBackResult =
  | { ok: true; issueId: string; issueNumber: number; href: string }
  | { ok: false; error: string };

/**
 * Creates the revert issue and records the request on the original, in one
 * transaction. An owner or admin may ask once; the revert issue then follows
 * the normal lifecycle (confirmation, bids, delivery, judgements, merge review).
 */
export async function createTakeItBack(input: {
  issueId: string;
  userId: string;
  userRole?: AppRole | null;
  reason: string;
  now?: Date;
}): Promise<CreateTakeItBackResult> {
  const reasonError = takeItBackReasonError(input.reason);
  if (reasonError) return { ok: false, error: reasonError };
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const issue = await tx.bug.findFirst({
      where: { id: input.issueId, isDeleted: false },
      select: {
        id: true, number: true, title: true, status: true, substatus: true, isDeleted: true,
        organisationId: true, projectId: true, reporterId: true, assigneeId: true, areaId: true, typeId: true,
        pullRequestUrl: true, updatedAt: true,
        project: { select: { slug: true, organisation: { select: { slug: true } } } },
      },
    });
    if (!issue) return { ok: false, error: "No such issue." };
    if (issue.status !== "resolved") {
      return { ok: false, error: "This issue is not merged, so there is nothing to take back." };
    }

    const membership = await tx.membership.findUnique({
      where: { organisationId_userId: { organisationId: issue.organisationId, userId: input.userId } },
      select: { role: true },
    });
    if (!isOrganisationAdmin(membership?.role, input.userRole)) {
      return { ok: false, error: "Only an organisation owner or admin can take an issue back." };
    }

    // Two owners clicking at once must not file two reverts.
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${issue.id} FOR UPDATE`;
    const locked = await tx.bug.findUniqueOrThrow({
      where: { id: issue.id },
      select: { status: true, isDeleted: true },
    });
    const read = await readMerge(tx, { ...issue, isDeleted: locked.isDeleted });
    const state = takeItBackState({
      status: locked.status,
      isDeleted: locked.isDeleted,
      membershipRole: membership?.role,
      appRole: input.userRole,
      mergedAt: read.mergedAt,
      existing: read.existing,
      now,
    });
    if (state.kind === "not_merged") {
      return { ok: false, error: "This issue is not merged, so there is nothing to take back." };
    }
    if (state.kind === "not_allowed") {
      return { ok: false, error: "Only an organisation owner or admin can take an issue back." };
    }
    if (state.kind === "already_requested") return { ok: false, error: state.message };
    if (state.kind === "too_old") {
      return {
        ok: false,
        error: `This issue has been merged for more than 30 days, so it can no longer be taken back. The window closed on ${state.endsAt.toISOString().slice(0, 10)}.`,
      };
    }

    const title = revertTitle(issue.number, issue.title);
    const description = revertDescription({
      originalNumber: issue.number,
      originalTitle: issue.title,
      reason: input.reason.trim(),
      requestedBy: input.userId,
      pullRequestUrl: issue.pullRequestUrl,
      mergedInto: read.mergedInto,
      mergeCommitSha: read.mergeCommitSha,
    });

    // AGENTS.md: an issue exists only by converting an idea. File the idea,
    // convert it in the same transaction, and open the issue at the usual start.
    const idea = await tx.idea.create({
      data: {
        title,
        description,
        status: "converted",
        convertedAt: now,
        organisationId: issue.organisationId,
        projectId: issue.projectId,
        reporterId: input.userId,
        beneficiaryUserId: issue.reporterId,
      },
      select: { id: true },
    });
    const watchIds = [...new Set([input.userId, issue.reporterId, issue.assigneeId].filter((id): id is string => Boolean(id)))];
    const revert = await tx.bug.create({
      data: {
        title,
        description,
        ...moveTo("requires_confirmation"),
        organisationId: issue.organisationId,
        projectId: issue.projectId,
        reporterId: input.userId,
        beneficiaryUserId: issue.reporterId,
        areaId: issue.areaId,
        typeId: issue.typeId,
        watches: { create: watchIds.map((userId) => ({ userId })) },
      },
      select: { id: true, number: true },
    });
    await tx.idea.update({ where: { id: idea.id }, data: { issueId: revert.id } });

    await tx.bugActivity.create({
      data: {
        bugId: revert.id,
        actorId: input.userId,
        type: "created",
        summary: `Created to take back issue #${issue.number}.`,
        metadata: {
          field: REVERT_OF_FIELD,
          originalIssueId: issue.id,
          originalIssueNumber: issue.number,
          reason: input.reason.trim(),
          requestedById: input.userId,
        },
      },
    });
    await tx.bugActivity.create({
      data: {
        bugId: issue.id,
        actorId: input.userId,
        type: "created",
        summary: `Take it back requested: revert issue #${revert.number} created.`,
        metadata: {
          field: TAKE_IT_BACK_FIELD,
          action: "requested",
          revertIssueId: revert.id,
          revertIssueNumber: revert.number,
          reason: input.reason.trim(),
        },
      },
    });

    await publish(tx, {
      organisationId: issue.organisationId,
      type: "issue.converted",
      bugId: revert.id,
      payload: {
        ideaId: idea.id,
        issueId: revert.id,
        issueNumber: revert.number,
        projectId: issue.projectId,
        revertOf: issue.number,
        reason: input.reason.trim(),
      },
    });

    return {
      ok: true,
      issueId: revert.id,
      issueNumber: revert.number,
      href: issuePath(projectRef(issue.project.organisation.slug, issue.project.slug), revert.number),
    };
  });
}

/**
 * When a revert merges, the original issue returns to Open with the owner's
 * reason. Runs in the caller's transaction, from both merge completion paths.
 */
export async function reopenOriginalAfterRevert(
  tx: Prisma.TransactionClient,
  revertIssueId: string,
): Promise<{ issueId: string; issueNumber: number } | null> {
  const [link, revert] = await Promise.all([
    tx.bugActivity.findFirst({
      where: { bugId: revertIssueId, type: "created", metadata: { path: ["field"], equals: REVERT_OF_FIELD } },
      orderBy: { createdAt: "asc" },
      select: { metadata: true },
    }),
    tx.bug.findUnique({ where: { id: revertIssueId }, select: { number: true, reporterId: true } }),
  ]);
  const meta = metadataOf(link?.metadata ?? null);
  const originalId = typeof meta?.originalIssueId === "string" ? meta.originalIssueId : null;
  if (!originalId) return null;

  const original = await tx.bug.findFirst({
    where: { id: originalId, isDeleted: false },
    select: {
      id: true, number: true, status: true, substatus: true, isDeleted: true,
      organisationId: true, projectId: true, pullRequestUrl: true, pullRequestHeadSha: true,
    },
  });
  if (!original) return null;
  const next = reopenedFromRevert(original);
  if (!next) return null;

  await tx.bug.update({
    where: { id: original.id },
    data: {
      ...moveTo("open"),
      // The merged fix is gone: its pull request and holder no longer apply.
      pullRequestUrl: null,
      pullRequestHeadSha: null,
      assigneeId: null,
    },
  });

  const reason = typeof meta?.reason === "string" ? meta.reason : "";
  const actorId = typeof meta?.requestedById === "string" ? meta.requestedById : revert?.reporterId;
  if (actorId) {
    await tx.bugActivity.create({
      data: {
        bugId: original.id,
        actorId,
        type: "status_changed",
        summary: `Returned to Open: revert issue #${revert?.number ?? "?"} merged.`,
        metadata: {
          field: "status",
          from: original.substatus,
          to: "open",
          via: "take_it_back",
          reason,
          revertIssueId,
          revertIssueNumber: revert?.number ?? null,
          pullRequestUrl: original.pullRequestUrl,
          pullRequestHeadSha: original.pullRequestHeadSha,
        },
      },
    });
  }
  await publish(tx, {
    organisationId: original.organisationId,
    type: "issue.reopened",
    bugId: original.id,
    payload: {
      issueId: original.id,
      issueNumber: original.number,
      projectId: original.projectId,
      from: original.substatus,
      ...moveTo("open"),
      via: "take_it_back",
      reason,
      revertIssueId,
      revertIssueNumber: revert?.number ?? null,
    },
  });

  return { issueId: original.id, issueNumber: original.number };
}
