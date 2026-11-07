import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isUnstructuredDraft, formatStructuredDescription } from "@/lib/ideas";
import {
  isTooThinToStructure,
  buildExtractionPrompt,
  parseExtraction,
  type Extraction,
} from "../../scripts/agents/structure-drafts";
import { audit } from "@/lib/agents/audit";
import { logger } from "@/lib/logger";
import { activeIn } from "@/lib/agents/active-in";

/**
 * Draft Idea Auto-Structuring Sweep (follow-up to #682 / #685).
 *
 * Rides the same in-process cron everything else in lib/cron/ rides
 * (instrumentation.ts -> startPlatformCron() -> runPlatformSweeps(), once a
 * minute inside the running server) rather than a separate GitHub Actions
 * workflow or Vercel cron. Needs only ANTHROPIC_API_KEY as an env var on
 * whatever actually runs the app (Coolify) -- no agent API key, since this
 * writes to the database directly, like the other platform sweeps. A real
 * agent row ("Structuring Bot") is still looked up per organisation, but only for
 * its id, to attribute the audit log entry -- not for a credential.
 *
 * Bounded: processes at most `limit` ideas per run, so one run can't run
 * away (#685 review feedback). Idempotent: re-checks isUnstructuredDraft()
 * on each idea immediately before writing, so a draft structured by
 * another run (or a human) in the meantime is skipped, never
 * double-written.
 */
export type DraftStructuringResult = {
  structured: number;
  flagged: number;
  skipped: number;
  failed: number;
  errors: Array<{ ideaId: string; error: string }>;
};

async function extractFields(
  anthropicApiKey: string,
  anthropicModel: string,
  issue: { title: string; description: string },
): Promise<Extraction> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildExtractionPrompt(issue) }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API -> ${response.status}: ${body.slice(0, 500)}`);
  }
  const data = await response.json();
  const text: string = data.content?.[0]?.text ?? "";
  return parseExtraction(text);
}

export async function sweepUndraftedIdeas(options?: {
  limit?: number;
  anthropicApiKey?: string;
  anthropicModel?: string;
}): Promise<DraftStructuringResult> {
  const limit = options?.limit ?? 20;
  const anthropicApiKey = options?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  const anthropicModel = options?.anthropicModel ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

  const result: DraftStructuringResult = { structured: 0, flagged: 0, skipped: 0, failed: 0, errors: [] };

  if (!anthropicApiKey) {
    logger.error("[cron] sweepUndraftedIdeas: ANTHROPIC_API_KEY is not configured, skipping run.");
    return result;
  }

  // Candidate pool: open, human-filed ideas. isUnstructuredDraft() narrows
  // further below (it needs the description text, not just a DB filter).
  const candidates = await prisma.idea.findMany({
    // #security-findings: a private finding's idea is a placeholder; it is never rewritten.
    where: { status: "open", isDeleted: false, createdByAgentId: null, securityFinding: { is: null } },
    select: { id: true, number: true, title: true, description: true, status: true, createdByAgentId: true, organisationId: true },
    orderBy: { createdAt: "asc" },
    take: limit * 2, // isUnstructuredDraft() will drop some; over-fetch a bit
  });

  const drafts = candidates.filter(isUnstructuredDraft).slice(0, limit);
  if (drafts.length === 0) return result;

  // The agent every structured idea gets attributed to. Resolved once per
  // run, scoped per-organisation below (an idea's organisation may differ).
  const agentCache = new Map<string, { id: string; organisationId: string } | null>();
  async function structuringAgentFor(organisationId: string) {
    if (agentCache.has(organisationId)) return agentCache.get(organisationId) ?? null;
    const agent = await prisma.agent.findFirst({
      where: { ...activeIn(organisationId), name: "Structuring Bot", revokedAt: null },
      select: { id: true },
    });
    const found = agent ? { id: agent.id, organisationId } : null;
    agentCache.set(organisationId, found);
    return found;
  }

  for (const idea of drafts) {
    try {
      if (isTooThinToStructure(idea.description)) {
        result.flagged++;
        continue;
      }

      const agent = await structuringAgentFor(idea.organisationId);
      if (!agent) {
        logger.error(`[cron] sweepUndraftedIdeas: no "Structuring Bot" agent found for organisation ${idea.organisationId}, skipping idea ${idea.id}.`);
        result.failed++;
        result.errors.push({ ideaId: idea.id, error: "No Structuring Bot agent configured for this organisation." });
        continue;
      }

      const fields = await extractFields(anthropicApiKey, anthropicModel, idea);

      // Re-check right before writing: another run or a human may have
      // structured/edited this idea since it was listed above.
      const fresh = await prisma.idea.findUnique({
        where: { id: idea.id },
        select: { id: true, title: true, description: true, status: true, createdByAgentId: true },
      });
      if (!fresh || fresh.status !== "open" || !isUnstructuredDraft(fresh)) {
        result.skipped++;
        continue;
      }

      const nextDescription = formatStructuredDescription(fresh.description, fields);

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.idea.update({
          where: { id: idea.id },
          data: { description: nextDescription },
        });
        await audit(
          { agentId: agent.id, organisationId: agent.organisationId },
          "idea.structured",
          `idea:${idea.id}`,
          { beforeTitle: fresh.title, afterTitle: fresh.title, beforeDescription: fresh.description },
          { db: tx },
        );
      });

      result.structured++;
    } catch (error) {
      logger.error(`[cron] sweepUndraftedIdeas: failed on idea ${idea.id}:`, error);
      result.failed++;
      result.errors.push({ ideaId: idea.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}
