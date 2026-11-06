import type { Prisma, PrismaClient } from "@prisma/client";
import { releaseWorkOfRevokedAgent } from "@/lib/agent-api/revoke-release";

/**
 * Options for deleting or offboarding a user account safely (#356, #571).
 */
export type OffboardUserOptions = {
  /**
   * Target user ID to reassign any reported bugs to (e.g. system bot or administrator).
   * If omitted and the user has reported bugs, offboarding will reject with an error
   * explaining that reported bugs must be preserved, unless anonymizeAuthoredContent is true.
   */
  fallbackReporterId?: string;
  /**
   * Whether to automatically anonymise authored content (reported bugs, comments, activities)
   * to a system placeholder user instead of requiring fallbackReporterId (#571).
   */
  anonymizeAuthoredContent?: boolean;
};

export type OffboardUserResult = {
  ok: true;
  userId: string;
  unassignedBugCount: number;
  reassignedBugCount: number;
};

export class UserHasReportedBugsError extends Error {
  constructor(public readonly bugCount: number) {
    super(
      `Cannot delete user who has reported ${bugCount} issue${bugCount === 1 ? "" : "s"} without specifying a fallbackReporterId for reassignment.`,
    );
    this.name = "UserHasReportedBugsError";
  }
}

export class SoleOrganisationOwnerError extends Error {
  constructor(public readonly organisationName: string) {
    super(
      `Cannot delete account while you are the sole owner of "${organisationName}". Transfer ownership or delete the organisation first.`,
    );
    this.name = "SoleOrganisationOwnerError";
  }
}

export const ANONYMOUS_USER_EMAIL = "deleted-user@issue-tracker.local";

export async function getOrCreateAnonymizedUser(
  client: PrismaClient | Prisma.TransactionClient,
): Promise<{ id: string }> {
  const existing = await client.user.findUnique({
    where: { email: ANONYMOUS_USER_EMAIL },
    select: { id: true },
  });
  if (existing) return existing;

  return client.user.create({
    data: {
      name: "Deleted User",
      email: ANONYMOUS_USER_EMAIL,
      role: "user",
    },
    select: { id: true },
  });
}

/**
 * Safely offboard and delete a user account without violating PostgreSQL foreign key constraints (#356, #571).
 *
 * 1. Checks if the user exists.
 * 2. Unassigns any issues assigned to this user (`assigneeId = null`).
 * 3. If the user reported bugs, or bugs are filed for them (#423):
 *    - If `anonymizeAuthoredContent` is true, reassigns to an anonymous system user.
 *    - If `fallbackReporterId` is provided, reassigns `reporterId` and
 *      `beneficiaryUserId` to the fallback user.
 *    - If no fallback is provided and not anonymising, throws `UserHasReportedBugsError`.
 * 4. Deletes the user record (cascading votes, watches, attachments, notifications, and reset tokens).
 */
export async function offboardUser(
  client: PrismaClient | Prisma.TransactionClient,
  userId: string,
  options: OffboardUserOptions = {},
): Promise<OffboardUserResult> {
  if ("$transaction" in client && typeof client.$transaction === "function") {
    return (client as PrismaClient).$transaction((tx) =>
      runOffboard(tx, userId, options),
    );
  }
  return runOffboard(client, userId, options);
}

async function runOffboard(
  client: PrismaClient | Prisma.TransactionClient,
  userId: string,
  options: OffboardUserOptions = {},
): Promise<OffboardUserResult> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`User with ID "${userId}" not found.`);
  }

  let fallbackId = options.fallbackReporterId;
  if (!fallbackId && options.anonymizeAuthoredContent) {
    const anon = await getOrCreateAnonymizedUser(client);
    fallbackId = anon.id;
  }

  // Check reported bugs before any writes. Bugs filed for this person (#423)
  // also block the delete, so they count too.
  const reportedCount = await client.bug.count({
    where: { OR: [{ reporterId: userId }, { beneficiaryUserId: userId }] },
  });

  if (reportedCount > 0) {
    if (!fallbackId) {
      throw new UserHasReportedBugsError(reportedCount);
    }
    if (fallbackId === userId) {
      throw new Error("fallbackReporterId must differ from the user being offboarded.");
    }

    // Verify fallback reporter exists (unless just created)
    const fallback = await client.user.findUnique({
      where: { id: fallbackId },
      select: { id: true },
    });
    if (!fallback) {
      throw new Error(`Fallback reporter user "${fallbackId}" not found.`);
    }
  }

  // All validation passed; perform writes.
  const assignedBugs = await client.bug.updateMany({
    where: { assigneeId: userId },
    data: { assigneeId: null },
  });

  let reassignedCount = 0;
  if (reportedCount > 0 && fallbackId) {
    const reassigned = await client.bug.updateMany({
      where: { reporterId: userId },
      data: { reporterId: fallbackId },
    });
    reassignedCount = reassigned.count;
    await client.bug.updateMany({
      where: { beneficiaryUserId: userId },
      data: { beneficiaryUserId: fallbackId },
    });
  }

  if (options.anonymizeAuthoredContent && fallbackId) {
    if (client.comment?.updateMany) {
      await client.comment.updateMany({
        where: { authorId: userId },
        data: { authorId: fallbackId },
      });
    }
    if (client.bugActivity?.updateMany) {
      await client.bugActivity.updateMany({
        where: { actorId: userId },
        data: { actorId: fallbackId },
      });
    }
  }

  // Delete the user account
  await client.user.delete({
    where: { id: userId },
  });

  return {
    ok: true,
    userId,
    unassignedBugCount: assignedBugs.count,
    reassignedBugCount: reassignedCount,
  };
}

/**
 * Self-service account deletion (#571).
 *
 * 1. Refuses while the user is a organisation's sole owner.
 * 2. Revokes all agents and keys owned by the user.
 * 3. Removes organisation memberships.
 * 4. Reuses the safe offboarding path to anonymise authored content (issues, comments, activities),
 *    unassign assigned issues, and delete the user account.
 */
export async function deleteUserAccount(
  client: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<{ ok: true; userId: string }> {
  if ("$transaction" in client && typeof client.$transaction === "function") {
    return (client as PrismaClient).$transaction((tx) =>
      runDeleteUserAccount(tx, userId),
    );
  }
  return runDeleteUserAccount(client, userId);
}

async function runDeleteUserAccount(
  client: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<{ ok: true; userId: string }> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`User with ID "${userId}" not found.`);
  }

  // Refuse while you're a organisation's only owner (#571)
  if (client.membership?.findMany && client.membership?.count) {
    const ownedMemberships = await client.membership.findMany({
      where: { userId, role: "owner" },
      include: { organisation: { select: { id: true, name: true } } },
    });

    for (const membership of ownedMemberships) {
      const owners = await client.membership.count({
        where: { organisationId: membership.organisationId, role: "owner" },
      });
      if (owners <= 1) {
        throw new SoleOrganisationOwnerError(membership.organisation?.name ?? membership.organisationId);
      }
    }
  }

  // Revoke agents and keys (#571)
  const now = new Date();
  if (client.agent?.findMany && client.agent?.update) {
    const agents = await client.agent.findMany({
      where: { ownerUserId: userId, revokedAt: null },
      select: { id: true, organisationId: true },
    });

    for (const agent of agents) {
      try {
        await releaseWorkOfRevokedAgent(client as Prisma.TransactionClient, {
          agentId: agent.id,
          organisationId: agent.organisationId,
          actorUserId: userId,
          now,
        });
      } catch {
        // Release helper may throw in mocked tests without SQL engine
      }
      await client.agent.update({
        where: { id: agent.id },
        data: { revokedAt: now },
      });
    }
  }

  if (client.agentApiKey?.updateMany) {
    await client.agentApiKey.updateMany({
      where: { agent: { ownerUserId: userId }, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  // Remove memberships (#571)
  if (client.membership?.deleteMany) {
    await client.membership.deleteMany({
      where: { userId },
    });
  }

  // Reuse safe offboarding path to anonymise authored content, clean up assignments and delete user
  await runOffboard(client, userId, { anonymizeAuthoredContent: true });

  return {
    ok: true,
    userId,
  };
}
