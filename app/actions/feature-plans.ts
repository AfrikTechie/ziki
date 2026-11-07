"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser, type SessionAppUser } from "@/lib/auth-helpers";
import { consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { generateFeatureDraft } from "@/lib/feature-plan-generation";
import { createFeaturePlan, featureContext, FeaturePlanError, findFeatureWork, publishFeaturePlan, saveFeaturePlan } from "@/lib/feature-plans";
import { featureDraftSchema, featureRequestSchema, featureScope } from "@/lib/validations/feature-plan";
import { logger } from "@/lib/logger";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const identity = z.object({ projectId: z.string().min(1).max(100), id: z.uuid(), version: z.number().int().min(1) });

async function action<T>(work: (user: SessionAppUser) => Promise<T>, generation = false): Promise<Result<T>> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`feature-plans:${generation ? "generate" : "write"}:${user.id}`, {
    max: generation ? 5 : 30, windowMs: generation ? 10 * 60_000 : 60_000,
  });
  if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };
  try {
    return { ok: true, value: await work(user) };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Check your plan's fields." };
    if (error instanceof FeaturePlanError) return { ok: false, error: error.message };
    logger.warn("[feature-plans] Action failed; no private request content logged.");
    return { ok: false, error: "We couldn't save this change. Your draft is still here; please try again." };
  }
}

export async function proposeFeaturePlanAction(projectId: string, input: unknown) {
  return action(async (user) => {
    const request = featureRequestSchema.parse(input);
    const context = await featureContext(user, projectId, request);
    const draft = await generateFeatureDraft(request, context);
    return { draft, work: context.work };
  }, true);
}

export async function findFeatureWorkAction(projectId: string, query: string) {
  return action(async (user) => findFeatureWork(user, projectId, z.string().trim().min(3).max(200).parse(query)));
}

export async function saveFeaturePlanAction(input: unknown) {
  return action(async (user) => {
    const parsed = identity.extend({ creating: z.boolean(), request: featureRequestSchema, draft: featureDraftSchema }).parse(input);
    const saved = parsed.creating
      ? await createFeaturePlan(user, parsed.projectId, parsed.id, parsed.request, parsed.draft)
      : await saveFeaturePlan(user, parsed.projectId, parsed.id, parsed.version, parsed.request, parsed.draft);
    revalidatePath("/[org]/[project]/features", "page");
    revalidatePath("/[org]/[project]/features/[id]", "page");
    return saved;
  });
}

export async function publishFeaturePlanAction(input: unknown) {
  return action(async (user) => {
    const parsed = identity.extend({ scope: featureScope }).parse(input);
    const published = await publishFeaturePlan(user, parsed.projectId, parsed.id, parsed.version, parsed.scope);
    revalidatePath("/[org]/[project]", "layout");
    return published;
  });
}
