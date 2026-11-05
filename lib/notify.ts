import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSendMail, sendMail } from "@/lib/mail";
import { getSiteUrl } from "@/lib/site-url";
import { issueHref } from "@/lib/issue-ref";
import {
  planNotifications,
  type NotificationEvent,
  type PlannedNotification,
} from "@/lib/notifications";
import { shouldNotify } from "@/lib/notification-prefs";
import { mutedUsersFor, watchersFor } from "@/lib/watch";
import { expireUnreadCounts } from "@/lib/cache-tags";
import { logger } from "@/lib/logger";

/**
 * Fills in the audience for events that go to an issue's watchers (#216):
 * new comments and status changes. Other events name their recipients.
 */
async function withWatchers(event: NotificationEvent): Promise<NotificationEvent> {
  if (event.kind === "comment_added") {
    const [recipientIds, muted] = await Promise.all([
      watchersFor(prisma, event.bugId, event.recipientIds),
      // Explicit "Unwatch" also silences reply notices to that person (#738).
      mutedUsersFor(prisma, event.bugId),
    ]);
    const excludeIds = [...new Set([...(event.excludeIds ?? []), ...muted])];
    return { ...event, recipientIds, ...(excludeIds.length ? { excludeIds } : {}) };
  }
  if (event.kind === "status_changed") {
    const bug = await prisma.bug.findUnique({
      where: { id: event.bugId },
      select: { assigneeId: true },
    });
    return {
      ...event,
      recipientIds: await watchersFor(prisma, event.bugId, [event.reporterId, bug?.assigneeId]),
    };
  }
  return event;
}

/** Writes the in-app feed rows (#216). Always, whatever the email settings. */
async function recordInApp(event: NotificationEvent, planned: PlannedNotification[], tenantId: string | null) {
  await prisma.notification.createMany({
    data: planned.map((n) => ({
      userId: n.userId,
      tenantId,
      bugId: event.bugId ?? null,
      kind: n.kind,
      title: n.title,
      url: n.url,
    })),
  });
  // The recipients' header badges (#317).
  expireUnreadCounts(planned.map((n) => n.userId));
}

/**
 * Concurrency limit for outgoing SMTP connections (#354).
 * Defaults to 2 simultaneous connections, configurable via SMTP_MAX_CONCURRENCY.
 */
export const DEFAULT_SMTP_CONCURRENCY = 2;

export function getSmtpConcurrency(): number {
  const envVal = Number(process.env.SMTP_MAX_CONCURRENCY || process.env.EMAIL_CONCURRENCY);
  return Number.isInteger(envVal) && envVal > 0 ? envVal : DEFAULT_SMTP_CONCURRENCY;
}

/**
 * Runs async tasks over items with bounded concurrency (#354).
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const safeLimit = Math.max(1, limit);
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workerCount = Math.min(safeLimit, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Shared concurrency limiter across all notification deliveries (#354).
 */
export class SmtpLimiter {
  private activeCount = 0;
  private queue: Array<() => void> = [];

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const limit = getSmtpConcurrency();
    if (this.activeCount >= limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.activeCount++;
    }

    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.activeCount--;
      }
    }
  }
}

export const sharedSmtpLimiter = new SmtpLimiter();

/** Emails everyone who hasn't opted out, with bounded SMTP concurrency (#210, #354). */
async function sendEmails(planned: PlannedNotification[]) {
  if (!canSendMail()) return;
  // Fetch the preferences rather than filtering in the query: which flag
  // matters depends on the kind of each planned notification, and one event
  // can produce several kinds across different recipients.
  const recipients = await prisma.user.findMany({
    where: { id: { in: planned.map((p) => p.userId) }, emailNotifications: true },
    select: {
      id: true,
      email: true,
      emailNotifications: true,
      notifyMentions: true,
      notifyAssignments: true,
      notifyStatusChanges: true,
    },
  });
  const byId = new Map(recipients.map((u) => [u.id, u]));

  const toSend: { to: string; subject: string; text: string; userId: string }[] = [];
  for (const n of planned) {
    const recipient = byId.get(n.userId);
    if (!recipient || !shouldNotify(recipient, n.kind)) continue;
    toSend.push({ to: recipient.email, subject: n.subject, text: n.text, userId: n.userId });
  }

  await Promise.all(
    toSend.map(async (item) => {
      try {
        await sharedSmtpLimiter.run(() =>
          sendMail({ to: item.to, subject: item.subject, text: item.text }),
        );
      } catch (error) {
        logger.error("[notify] failed to send", { userId: item.userId, error });
      }
    }),
  );
}

/** Deliver one event: in-app feed for everyone it concerns, plus email. */
export async function deliverNotifications(event: NotificationEvent): Promise<void> {
  let tenantId = "tenantId" in event ? event.tenantId ?? null : null;
  let issueAddress: string | null = null;
  // The issue may have been deleted between the action and delivery. Agent
  // and platform events (#443) need not be about an issue at all.
  if (event.bugId) {
    const bug = await prisma.bug.findUnique({
      where: { id: event.bugId },
      select: { isDeleted: true, tenantId: true, number: true, project: { select: { slug: true, tenant: { select: { slug: true } } } } },
    });
    if (!bug || bug.isDeleted) return;
    tenantId = bug.tenantId;
    issueAddress = issueHref(bug);
  }

  const planned = planNotifications(await withWatchers(event), getSiteUrl(), issueAddress);
  if (planned.length === 0) return;

  // The invitee cannot switch into this workspace until they accept, so the
  // row must stay personal or their current workspace hides it.
  const storedTenantId = event.kind === "tenant_invite" ? null : tenantId;

  try {
    await recordInApp(event, planned, storedTenantId);
  } catch (error) {
    // The feed failing must not stop the emails.
    logger.error("[notify] failed to record in-app notifications", error);
  }
  await sendEmails(planned);
}

/**
 * Queue notifications to go out after the response, so a slow or failing
 * mail server never delays or breaks the action that triggered them.
 */
export function notifyLater(...events: NotificationEvent[]): void {
  after(async () => {
    for (const event of events) {
      try {
        await deliverNotifications(event);
      } catch (error) {
        logger.error("[notify] delivery failed", error);
      }
    }
  });
}
