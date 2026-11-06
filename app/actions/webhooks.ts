"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { organisationForOwner } from "@/lib/agents/membership";
import { checkSsrf } from "@/lib/webhooks/ssrf";
import { generateSigningSecret, encryptSigningSecret } from "@/lib/webhooks/sign";
import { MAX_SUBSCRIPTIONS_PER_AGENT } from "@/lib/webhooks/manage";
import { deliverySummaries } from "@/lib/webhooks/history";
import { z } from "zod";
import { fromZodError } from "@/lib/form-errors";
import { activeIn } from "@/lib/agents/active-in";

const createWebhookSchema = z.object({
  agentId: z.string().min(1, "Select an agent."),
  url: z.string().url("Enter a valid URL.").max(2048, "URL is too long."),
});

export type AgentChoice = {
  id: string;
  name: string;
  avatar: string | null;
};

export type WebhookSubscriptionRow = {
  id: string;
  url: string;
  enabled: boolean;
  failureCount: number;
  disabledAt: Date | null;
  createdAt: Date;
  lastError: string | null;
  lastErrorAt: Date | null;
  lastDeliveredAt: Date | null;
  agent: { id: string; name: string; avatar: string | null };
};

export type ListWebhooksResult =
  | { ok: true; subscriptions: WebhookSubscriptionRow[]; agents: AgentChoice[] }
  | { ok: false; error: string };

export async function listWebhooksAction(): Promise<ListWebhooksResult> {
  const user = await requireUser();
  const organisation = await organisationForOwner(user.id);
  if (!organisation) {
    return { ok: false, error: "No organisation found. Create or join an organisation first." };
  }

  const agents = await prisma.agent.findMany({
    where: { ownerUserId: user.id, ...activeIn(organisation.organisationId), revokedAt: null },
    select: { id: true, name: true, avatar: true },
  });

  if (agents.length === 0) {
    return { ok: true, subscriptions: [], agents: [] };
  }

  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { agentId: { in: agents.map((a) => a.id) } },
    select: {
      id: true,
      url: true,
      enabled: true,
      failureCount: true,
      disabledAt: true,
      createdAt: true,
      agent: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const summaries = await deliverySummaries(prisma, subscriptions.map((s) => s.id));

  return {
    ok: true,
    subscriptions: subscriptions.map((s) => {
      const summary = summaries.get(s.id);
      return {
        id: s.id,
        url: s.url,
        enabled: s.enabled,
        failureCount: s.failureCount,
        disabledAt: s.disabledAt,
        createdAt: s.createdAt,
        lastError: summary?.lastError ?? null,
        lastErrorAt: summary?.lastErrorAt ?? null,
        lastDeliveredAt: summary?.lastDeliveredAt ?? null,
        agent: s.agent,
      };
    }),
    agents,
  };
}

export type CreateWebhookResult =
  | { ok: true; secret: string; subscription: WebhookSubscriptionRow }
  | { ok: false; error: string; field?: string };

export async function createWebhookAction(
  _previous: unknown,
  formData: FormData,
): Promise<CreateWebhookResult> {
  const user = await requireUser();
  const organisation = await organisationForOwner(user.id);
  if (!organisation) {
    return { ok: false, error: "No organisation found." };
  }

  const parsed = createWebhookSchema.safeParse({
    agentId: formData.get("agentId"),
    url: formData.get("url"),
  });
  if (!parsed.success) {
    const first = fromZodError(parsed.error, "Invalid input.");
    return { ok: false, error: first.error, field: first.field };
  }

  const { agentId, url } = parsed.data;

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ownerUserId: user.id, ...activeIn(organisation.organisationId), revokedAt: null },
    select: { id: true },
  });
  if (!agent) {
    return { ok: false, error: "Agent not found.", field: "agentId" };
  }

  const ssrf = await checkSsrf(url);
  if (!ssrf.ok) {
    return { ok: false, error: ssrf.reason, field: "url" };
  }

  const existingCount = await prisma.webhookSubscription.count({
    where: { agentId },
  });
  if (existingCount >= MAX_SUBSCRIPTIONS_PER_AGENT) {
    return {
      ok: false,
      error: `An agent can have at most ${MAX_SUBSCRIPTIONS_PER_AGENT} webhook subscriptions. Delete one first.`,
      field: "url",
    };
  }

  try {
    const rawSecret = generateSigningSecret();
    const signingSecretEncrypted = encryptSigningSecret(rawSecret);

    const subscription = await prisma.webhookSubscription.create({
      data: {
        agentId,
        url,
        signingSecretEncrypted,
      },
      select: {
        id: true,
        url: true,
        enabled: true,
        failureCount: true,
        disabledAt: true,
        createdAt: true,
        agent: { select: { id: true, name: true, avatar: true } },
      },
    });

    revalidatePath("/settings/webhooks");
    return {
      ok: true,
      secret: rawSecret,
      subscription: {
        id: subscription.id,
        url: subscription.url,
        enabled: subscription.enabled,
        failureCount: subscription.failureCount,
        disabledAt: subscription.disabledAt,
        createdAt: subscription.createdAt,
        lastError: null,
        lastErrorAt: null,
        lastDeliveredAt: null,
        agent: subscription.agent,
      },
    };
  } catch {
    return { ok: false, error: "Webhook configuration unavailable. Try again." };
  }
}

export type ReEnableWebhookResult = { ok: true } | { ok: false; error: string };

export async function reEnableWebhookAction(webhookId: unknown): Promise<ReEnableWebhookResult> {
  if (typeof webhookId !== "string") return { ok: false, error: "Invalid webhook." };
  const user = await requireUser();
  const organisation = await organisationForOwner(user.id);
  if (!organisation) return { ok: false, error: "No organisation found." };

  const subscription = await prisma.webhookSubscription.findFirst({
    where: {
      id: webhookId,
      agent: { ownerUserId: user.id, ...activeIn(organisation.organisationId) },
    },
    select: { id: true, enabled: true },
  });
  if (!subscription) return { ok: false, error: "Webhook subscription not found." };
  if (subscription.enabled) return { ok: true };

  try {
    await prisma.webhookSubscription.update({
      where: { id: webhookId },
      data: { enabled: true, disabledAt: null, failureCount: 0 },
    });
    revalidatePath("/settings/webhooks");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not re-enable webhook." };
  }
}

export type DeleteWebhookResult = { ok: true } | { ok: false; error: string };

export async function deleteWebhookAction(webhookId: unknown): Promise<DeleteWebhookResult> {
  if (typeof webhookId !== "string") return { ok: false, error: "Invalid webhook." };
  const user = await requireUser();
  const organisation = await organisationForOwner(user.id);
  if (!organisation) return { ok: false, error: "No organisation found." };

  const subscription = await prisma.webhookSubscription.findFirst({
    where: {
      id: webhookId,
      agent: { ownerUserId: user.id, ...activeIn(organisation.organisationId) },
    },
    select: { id: true },
  });
  if (!subscription) return { ok: false, error: "Webhook subscription not found." };

  try {
    await prisma.webhookSubscription.delete({ where: { id: webhookId } });
    revalidatePath("/settings/webhooks");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete webhook." };
  }
}