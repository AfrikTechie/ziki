import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import { bugInOrganisation } from "@/lib/organisation-context";
import { expireUnreadCounts } from "@/lib/cache-tags";
import {
  ASKABLE_STATUSES,
  ELIGIBLE_AGENT_LEVELS,
} from "@/lib/validations/support-thread";

export type SupportThreadResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Creates or updates notifications for support threads and invalidates recipient badges.
 */
export async function notifySupportThread(
  db: Db,
  {
    organisationId,
    bugId,
    threadId,
    recipientUserIds,
    title,
  }: {
    organisationId: string;
    bugId: string;
    threadId: string;
    recipientUserIds: string[];
    title: string;
  },
): Promise<string[]> {
  const uniqueUserIds = [...new Set(recipientUserIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return [];

  await db.notification.createMany({
    data: uniqueUserIds.map((userId) => ({
      userId,
      organisationId,
      bugId,
      kind: "support_thread",
      title,
      url: `/inbox?tab=requests&thread=${threadId}`,
    })),
  });
  return uniqueUserIds;
}

/**
 * Counts how many non-revoked manager/merger agents the user owns in the organisation.
 */
export async function countUserEligibleAgents(userId: string, organisationId: string): Promise<number> {
  return prisma.agent.count({
    where: {
      ownerUserId: userId,
      revokedAt: null,
      activations: {
        some: {
          organisationId,
          deactivatedAt: null,
          level: { in: [...ELIGIBLE_AGENT_LEVELS] },
        },
      },
    },
  });
}

/**
 * Gets non-revoked manager/merger agents the user owns in the organisation.
 */
export async function getUserEligibleAgents(userId: string, organisationId: string) {
  return prisma.agent.findMany({
    where: {
      ownerUserId: userId,
      revokedAt: null,
      activations: {
        some: {
          organisationId,
          deactivatedAt: null,
          level: { in: [...ELIGIBLE_AGENT_LEVELS] },
        },
      },
    },
    select: { id: true, name: true, username: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Number of open requests the user could take (0 if they own no eligible agent).
 */
export async function countOpenRequestsForUser(userId: string, organisationId: string): Promise<number> {
  const eligibleCount = await countUserEligibleAgents(userId, organisationId);
  if (eligibleCount === 0) return 0;
  return prisma.supportThread.count({
    where: {
      organisationId,
      status: "open",
      requesterUserId: { not: userId },
    },
  });
}

/**
 * Returns the Prisma `where` clause for threads visible to the user in this organisation.
 */
export async function supportThreadVisibilityWhere(
  userId: string,
  organisationId: string,
): Promise<Prisma.SupportThreadWhereInput> {
  const eligibleCount = await countUserEligibleAgents(userId, organisationId);
  if (eligibleCount === 0) {
    return {
      organisationId,
      requesterUserId: userId,
    };
  }

  return {
    organisationId,
    OR: [
      { requesterUserId: userId },
      { status: "open" },
      { assigneeAgent: { ownerUserId: userId } },
    ],
  };
}

/**
 * Creates a support thread on an issue. If an active thread already exists
 * for this (bug, requester), returns the existing thread.
 */
export async function createSupportThread(
  user: { id: string; name?: string | null },
  organisationId: string,
  issueId: string,
  body: string,
): Promise<SupportThreadResult<{ threadId: string; existing: boolean }>> {
  const bug = await prisma.bug.findFirst({
    where: { id: issueId, ...bugInOrganisation(organisationId), isDeleted: false },
    select: { id: true, number: true, title: true, status: true, organisationId: true },
  });
  if (!bug) return { ok: false, error: "Issue not found." };
  if (!ASKABLE_STATUSES.includes(bug.status as (typeof ASKABLE_STATUSES)[number])) {
    return { ok: false, error: "You can only ask about fixes that are in progress, done, or in merge." };
  }

  const lockKey = `support-thread:${bug.id}:${user.id}`;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const existing = await tx.supportThread.findFirst({
      where: {
        bugId: bug.id,
        requesterUserId: user.id,
        organisationId,
        status: { in: ["open", "taken"] },
      },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, threadId: existing.id, existing: true };
    }

    const thread = await tx.supportThread.create({
      data: {
        organisationId,
        bugId: bug.id,
        requesterUserId: user.id,
        status: "open",
        lastMessageAt: new Date(),
        messages: {
          create: {
            authorUserId: user.id,
            body,
          },
        },
      },
      select: { id: true },
    });

    const eligibleAgents = await tx.agent.findMany({
      where: {
        revokedAt: null,
        ownerUserId: { not: user.id },
        activations: {
          some: {
            organisationId,
            deactivatedAt: null,
            level: { in: [...ELIGIBLE_AGENT_LEVELS] },
          },
        },
      },
      select: { id: true },
    });

    if (eligibleAgents.length > 0) {
      await tx.agentInboxItem.createMany({
        data: eligibleAgents.map((agent) => ({
          agentId: agent.id,
          kind: "request",
          eventType: "request.created",
          eventId: null,
          bugId: bug.id,
          payload: {
            threadId: thread.id,
            bugId: bug.id,
            issue: { number: bug.number, title: bug.title },
            from: { type: "user", id: user.id, name: user.name ?? null },
            body,
          },
        })),
      });
    }

    return { ok: true, threadId: thread.id, existing: false };
  });
}

/**
 * Requester adds a message while open or taken. If taken, notifies assignee agent.
 */
export async function addRequesterMessage(
  user: { id: string; name?: string | null },
  organisationId: string,
  threadId: string,
  body: string,
): Promise<SupportThreadResult> {
  const thread = await prisma.supportThread.findFirst({
    where: { id: threadId, organisationId },
    include: { bug: { select: { number: true, title: true } } },
  });
  if (!thread) return { ok: false, error: "Request not found." };
  if (thread.requesterUserId !== user.id) {
    return { ok: false, error: "Only the requester can add follow-up messages." };
  }
  if (thread.status === "resolved") {
    return { ok: false, error: "This request has already been resolved." };
  }

  const now = new Date();
  let notifiedUserIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.threadMessage.create({
      data: {
        threadId: thread.id,
        authorUserId: user.id,
        authorAgentId: null,
        body,
        createdAt: now,
      },
    });
    await tx.supportThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: now },
    });

    if (thread.status === "taken" && thread.assigneeAgentId) {
      await tx.agentInboxItem.create({
        data: {
          agentId: thread.assigneeAgentId,
          kind: "request",
          eventType: "request.message",
          eventId: null,
          bugId: thread.bugId,
          payload: {
            threadId: thread.id,
            bugId: thread.bugId,
            issue: { number: thread.bug.number, title: thread.bug.title },
            from: { type: "user", id: user.id, name: user.name ?? null },
            body,
          },
          createdAt: now,
        },
      });

      const assigneeAgent = await tx.agent.findUnique({
        where: { id: thread.assigneeAgentId },
        select: { ownerUserId: true },
      });
      if (assigneeAgent && assigneeAgent.ownerUserId !== user.id) {
        notifiedUserIds = await notifySupportThread(tx, {
          organisationId,
          bugId: thread.bugId,
          threadId: thread.id,
          recipientUserIds: [assigneeAgent.ownerUserId],
          title: `New message on #${thread.bug.number}: ${thread.bug.title}`,
        });
      }
    }
  });

  if (notifiedUserIds.length > 0) {
    expireUnreadCounts(notifiedUserIds);
  }

  return { ok: true };
}

/**
 * Human owner of an eligible manager/merger agent takes an open thread.
 */
export async function takeSupportThread(
  user: { id: string },
  organisationId: string,
  threadId: string,
  agentId: string,
): Promise<SupportThreadResult> {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      ownerUserId: user.id,
      revokedAt: null,
      activations: {
        some: {
          organisationId,
          deactivatedAt: null,
          level: { in: [...ELIGIBLE_AGENT_LEVELS] },
        },
      },
    },
    select: { id: true, name: true },
  });
  if (!agent) {
    return { ok: false, error: "You must choose an active manager or merger agent you own." };
  }

  const thread = await prisma.supportThread.findFirst({
    where: { id: threadId, organisationId },
    include: { bug: { select: { number: true, title: true } } },
  });
  if (!thread) return { ok: false, error: "Request not found." };
  if (thread.requesterUserId === user.id) {
    return { ok: false, error: "You cannot take your own request." };
  }

  const now = new Date();
  const updated = await prisma.supportThread.updateMany({
    where: { id: threadId, organisationId, status: "open" },
    data: {
      status: "taken",
      assigneeAgentId: agent.id,
      takenAt: now,
      lastMessageAt: now,
    },
  });

  if (updated.count !== 1) {
    return { ok: false, error: "Someone already took this request." };
  }

  const notifiedUserIds = await notifySupportThread(prisma, {
    organisationId,
    bugId: thread.bugId,
    threadId: thread.id,
    recipientUserIds: [thread.requesterUserId],
    title: `${agent.name} took your request on #${thread.bug.number}`,
  });
  if (notifiedUserIds.length > 0) {
    expireUnreadCounts(notifiedUserIds);
  }

  return { ok: true };
}

/**
 * Human owner answers as the assigned agent.
 */
export async function replySupportThread(
  user: { id: string },
  organisationId: string,
  threadId: string,
  body: string,
): Promise<SupportThreadResult> {
  const thread = await prisma.supportThread.findFirst({
    where: { id: threadId, organisationId },
    include: {
      bug: { select: { number: true, title: true } },
      assigneeAgent: { select: { id: true, name: true, ownerUserId: true } },
    },
  });
  if (!thread) return { ok: false, error: "Request not found." };
  if (thread.status !== "taken") return { ok: false, error: "Can only reply to taken requests." };
  if (!thread.assigneeAgent || thread.assigneeAgent.ownerUserId !== user.id) {
    return { ok: false, error: "Only the owner of the assigned agent can reply." };
  }

  const now = new Date();
  let notifiedUserIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.threadMessage.create({
      data: {
        threadId: thread.id,
        authorUserId: user.id,
        authorAgentId: thread.assigneeAgentId,
        body,
        createdAt: now,
      },
    });
    await tx.supportThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: now },
    });
    notifiedUserIds = await notifySupportThread(tx, {
      organisationId,
      bugId: thread.bugId,
      threadId: thread.id,
      recipientUserIds: [thread.requesterUserId],
      title: `${thread.assigneeAgent!.name} replied to your request on #${thread.bug.number}`,
    });
  });

  if (notifiedUserIds.length > 0) {
    expireUnreadCounts(notifiedUserIds);
  }

  return { ok: true };
}

/**
 * Assignee owner releases thread back to open.
 */
export async function releaseSupportThread(
  user: { id: string },
  organisationId: string,
  threadId: string,
): Promise<SupportThreadResult> {
  const thread = await prisma.supportThread.findFirst({
    where: { id: threadId, organisationId },
    include: {
      bug: { select: { number: true, title: true } },
      assigneeAgent: { select: { id: true, name: true, ownerUserId: true } },
      requester: { select: { id: true, name: true } },
    },
  });
  if (!thread) return { ok: false, error: "Request not found." };
  if (thread.status !== "taken") return { ok: false, error: "Can only release taken requests." };
  if (!thread.assigneeAgent || thread.assigneeAgent.ownerUserId !== user.id) {
    return { ok: false, error: "Only the owner of the assigned agent can release this request." };
  }

  const now = new Date();
  const released = await prisma.$transaction(async (tx) => {
    // Only while it is still taken by this agent: a thread resolved meanwhile
    // (by hand, or because the fix went live) must not reopen.
    const moved = await tx.supportThread.updateMany({
      where: { id: thread.id, status: "taken", assigneeAgentId: thread.assigneeAgent!.id },
      data: {
        status: "open",
        assigneeAgentId: null,
        takenAt: null,
        lastMessageAt: now,
      },
    });
    if (moved.count !== 1) return false;

    const eligibleAgents = await tx.agent.findMany({
      where: {
        revokedAt: null,
        ownerUserId: { not: thread.requesterUserId },
        activations: {
          some: {
            organisationId,
            deactivatedAt: null,
            level: { in: [...ELIGIBLE_AGENT_LEVELS] },
          },
        },
      },
      select: { id: true },
    });

    if (eligibleAgents.length > 0) {
      await tx.agentInboxItem.createMany({
        data: eligibleAgents.map((agent) => ({
          agentId: agent.id,
          kind: "request",
          eventType: "request.released",
          eventId: null,
          bugId: thread.bugId,
          payload: {
            threadId: thread.id,
            bugId: thread.bugId,
            issue: { number: thread.bug.number, title: thread.bug.title },
            from: { type: "user", id: thread.requester.id, name: thread.requester.name },
          },
          createdAt: now,
        })),
      });
    }
    return true;
  });
  if (!released) return { ok: false, error: "This request changed meanwhile. Reload to see where it is." };

  return { ok: true };
}

/**
 * Requester or assignee's owner manually marks thread resolved.
 */
export async function resolveSupportThread(
  user: { id: string },
  organisationId: string,
  threadId: string,
): Promise<SupportThreadResult> {
  const thread = await prisma.supportThread.findFirst({
    where: { id: threadId, organisationId },
    include: {
      bug: { select: { number: true, title: true } },
      assigneeAgent: { select: { id: true, name: true, ownerUserId: true } },
    },
  });
  if (!thread) return { ok: false, error: "Request not found." };
  if (thread.status === "resolved") return { ok: true };

  const isRequester = thread.requesterUserId === user.id;
  const isAssigneeOwner = thread.assigneeAgent?.ownerUserId === user.id;
  if (!isRequester && !isAssigneeOwner) {
    return { ok: false, error: "Only the requester or the assigned agent's owner can resolve this request." };
  }

  const otherUserId = isRequester ? thread.assigneeAgent?.ownerUserId : thread.requesterUserId;
  const now = new Date();
  let notifiedUserIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    await tx.supportThread.update({
      where: { id: thread.id },
      data: {
        status: "resolved",
        resolvedAt: now,
        resolvedReason: "manual",
      },
    });

    if (otherUserId) {
      notifiedUserIds = await notifySupportThread(tx, {
        organisationId,
        bugId: thread.bugId,
        threadId: thread.id,
        recipientUserIds: [otherUserId],
        title: `Request on #${thread.bug.number} marked resolved`,
      });
    }
  });

  if (notifiedUserIds.length > 0) {
    expireUnreadCounts(notifiedUserIds);
  }

  return { ok: true };
}

/**
 * Auto-closes open/taken support threads when an issue goes Live or is Closed.
 * Runs inside the caller's transaction. Never throws on 0 matching threads.
 */
export async function closeSupportThreadsForIssue(
  tx: Prisma.TransactionClient,
  { bugId, reason }: { bugId: string; reason: "fix_live" | "issue_closed" },
): Promise<void> {
  const threads = await tx.supportThread.findMany({
    where: {
      bugId,
      status: { in: ["open", "taken"] },
    },
    select: {
      id: true,
      organisationId: true,
      requesterUserId: true,
      assigneeAgent: { select: { ownerUserId: true } },
      bug: { select: { number: true, title: true } },
    },
  });
  if (threads.length === 0) return;

  const now = new Date();
  await tx.supportThread.updateMany({
    where: {
      bugId,
      status: { in: ["open", "taken"] },
    },
    data: {
      status: "resolved",
      resolvedAt: now,
      resolvedReason: reason,
    },
  });

  const notifications: {
    userId: string;
    organisationId: string;
    bugId: string;
    kind: string;
    title: string;
    url: string;
  }[] = [];
  const notifyUserIds: string[] = [];

  const reasonText = reason === "fix_live" ? "fix is now live" : "issue was closed";
  for (const t of threads) {
    const title = `Request on #${t.bug.number} resolved (${reasonText})`;
    const url = `/inbox?tab=requests&thread=${t.id}`;
    const recipients = new Set<string>();
    if (t.requesterUserId) recipients.add(t.requesterUserId);
    if (t.assigneeAgent?.ownerUserId) recipients.add(t.assigneeAgent.ownerUserId);

    for (const uid of recipients) {
      notifications.push({
        userId: uid,
        organisationId: t.organisationId,
        bugId,
        kind: "support_thread",
        title,
        url,
      });
      notifyUserIds.push(uid);
    }
  }

  if (notifications.length > 0) {
    await tx.notification.createMany({ data: notifications });
    try {
      after(() => expireUnreadCounts(notifyUserIds));
    } catch {
      expireUnreadCounts(notifyUserIds);
    }
  }
}

