"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { convertIdea, giveIdeaVerdict, ideaVerdictSchema, rejectIdea, withdrawIdea } from "@/lib/agent-api/idea-verdicts";
import { awardingAgentOf } from "@/lib/bid-award-permission";
import { redirect } from "next/navigation";
import { ideaPath, projectPath, refOf } from "@/lib/project-paths";
import { IssueApiError } from "@/lib/agent-api/errors";
import { ACTION_RATE_LIMITS, consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { checkPostForSecrets } from "@/lib/security/secret-guard";

export type IdeaVerdictActionResult = {
  ok?: true;
  error?: string;
  /** True when this replaced the person's earlier verdict. */
  replaced?: boolean;
  ideaScore?: number;
  ideaThreshold?: number;
};

/**
 * The idea a verdict is for, in any organisation the person belongs to (any for
 * the site super admin). Not scoped by the active-organisation cookie: a tab
 * left open on one organisation while another tab switched the cookie would
 * otherwise get "Idea not found" for an idea it is showing.
 */
async function ideaForVerdict(user: { id: string; role?: string | null }, ideaId: string) {
  if (typeof ideaId !== "string" || !ideaId) return null;
  return prisma.idea.findFirst({
    where: {
      id: ideaId,
      isDeleted: false,
      organisation: { archivedAt: null },
      ...(user.role === "super_admin"
        ? {}
        : {
            OR: [
              { organisation: { memberships: { some: { userId: user.id } } } },
              { project: { memberships: { some: { userId: user.id } } } },
            ],
          }),
    },
    select: { id: true, number: true, projectId: true, organisationId: true },
  });
}

/**
 * A person gives an idea their verdict from the web app (#idea-verdicts):
 * good, bad or neutral, a summary of two sentences at most, and a full description.
 * Always one vote. A newer verdict replaces their earlier one.
 */
export async function giveIdeaVerdictAction(
  ideaId: string,
  formData: FormData,
): Promise<IdeaVerdictActionResult> {
  const user = await requireUser();
  const userId = user.id;

  const limit = await consumeRateLimit(`idea-verdict:${userId}`, ACTION_RATE_LIMITS.addComment);
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };

  const idea = await ideaForVerdict(user, ideaId);
  if (!idea) return { error: "Idea not found" };
  const organisationId = idea.organisationId;

  const parsed = ideaVerdictSchema.safeParse({
    opinion: formData.get("opinion") ?? undefined,
    summary: formData.get("summary") ?? "",
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "opinion") return { error: "Pick good, bad or neutral." };
    return { error: issue?.message ?? "Check your verdict and try again." };
  }

  // #secret-protection: a verdict is posted on the idea for everyone to read.
  const secrets = await checkPostForSecrets({
    organisationId,
    projectId: idea.projectId,
    actor: { kind: "user", userId },
    source: "idea_verdict",
    ideaId: idea.id,
    fields: { summary: parsed.data.summary, description: parsed.data.description },
    noun: "this verdict",
  });
  if (!secrets.ok) return { error: secrets.message };

  try {
    const given = await giveIdeaVerdict({ organisationId, userId }, idea.projectId, idea.id, parsed.data);
    revalidatePath("/[org]/[project]", "layout");
    return { ok: true, replaced: given.replaced, ideaScore: given.ideaScore, ideaThreshold: given.ideaThreshold };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    console.error("[idea-verdict] failed", error);
    return { error: "Could not save your verdict. Please try again." };
  }
}

/** What a one-tap verdict from the ideas list says, since every verdict carries a summary and a description. */
const QUICK_VERDICT = {
  good: { summary: "Voted good from the ideas list.", description: "Voted good with one tap from the ideas list, without a written reason." },
  bad: { summary: "Voted bad from the ideas list.", description: "Voted bad with one tap from the ideas list, without a written reason." },
} as const;

/**
 * A person votes an idea good or bad with one tap on the ideas list's vote
 * box: the same verdict as giveIdeaVerdictAction's, with a fixed summary and
 * description saying it came from the list. A newer verdict replaces theirs.
 */
export async function quickIdeaVerdictAction(ideaId: string, opinion: "good" | "bad"): Promise<IdeaVerdictActionResult> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`idea-verdict:${user.id}`, ACTION_RATE_LIMITS.addComment);
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };

  if (opinion !== "good" && opinion !== "bad") return { error: "Idea not found" };
  const idea = await ideaForVerdict(user, ideaId);
  if (!idea) return { error: "Idea not found" };
  const organisationId = idea.organisationId;

  try {
    const input = ideaVerdictSchema.parse({ opinion, ...QUICK_VERDICT[opinion] });
    const given = await giveIdeaVerdict({ organisationId, userId: user.id }, idea.projectId, idea.id, input);
    revalidatePath("/[org]/[project]", "layout");
    return { ok: true, replaced: given.replaced, ideaScore: given.ideaScore, ideaThreshold: given.ideaThreshold };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    console.error("[idea-verdict] quick verdict failed", error);
    return { error: "Could not save that. Please try again." };
  }
}

/**
 * The idea's owner withdraws their own open idea from its page
 * (#idea-withdraw): the same core as `POST /api/v1/ideas/{id}/withdraw`, so
 * only the owner may and only while it is open. It is archived with reason
 * `withdrawn`. Returns an error message, or nothing when it worked.
 */
export async function withdrawIdeaFromPage(ideaId: string): Promise<{ ok?: true; error?: string }> {
  const user = await requireUser();
  const userId = user.id;
  const limit = await consumeRateLimit(`idea-withdraw:${userId}`, ACTION_RATE_LIMITS.addComment);
  if (!limit.allowed) return { error: RATE_LIMIT_MESSAGE };

  const organisationId = await currentOrganisationIdFor(userId);
  if (!organisationId || typeof ideaId !== "string" || !ideaId) return { error: "Idea not found" };
  const idea = await prisma.idea.findFirst({
    where: { id: ideaId, organisationId, isDeleted: false },
    select: { id: true, number: true, projectId: true },
  });
  if (!idea) return { error: "Idea not found" };

  try {
    await withdrawIdea({ organisationId, userId, agentId: null }, idea.projectId, idea.id);
    revalidatePath("/[org]/[project]", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof IssueApiError) return { error: error.message };
    console.error("[idea-withdraw] failed", error);
    return { error: "Could not withdraw the idea. Please try again." };
  }
}

/** The idea page's Withdraw form posts here, with the idea's id in `ideaId`. */
export async function withdrawIdeaAction(formData: FormData): Promise<void> {
  const ideaId = formData.get("ideaId");
  await withdrawIdeaFromPage(typeof ideaId === "string" ? ideaId : "");
}

/**
 * The idea page's Approve and Reject (#idea-actions): the person acts through
 * their highest-level agent in the organisation, under the same rules as
 * `POST /api/v1/ideas/{id}/convert` and `/reject`. Approving converts an idea
 * whose score reached the threshold; rejecting is a manager agent's, for a bad
 * idea. Both land back on the idea (approve opens the issue it became).
 */
async function ideaDecision(formData: FormData, decide: "approve" | "reject"): Promise<void> {
  const user = await requireUser();
  const ideaId = String(formData.get("ideaId") ?? "");
  const organisationId = await currentOrganisationIdFor(user.id);
  if (!organisationId || !ideaId) return;
  const idea = await prisma.idea.findFirst({
    where: { id: ideaId, organisationId, isDeleted: false },
    select: { id: true, number: true, projectId: true, project: { select: { slug: true, organisation: { select: { slug: true } } } } },
  });
  if (!idea) return;
  const agent = await awardingAgentOf(user.id, organisationId);
  if (!agent) return;
  const context = { agentId: agent.id, name: agent.name, ownerId: agent.ownerUserId, organisationId: agent.organisationId, level: agent.level, burst: false, keyId: "web" };
  let issueNumber: number | null = null;
  try {
    if (decide === "approve") {
      const converted = await convertIdea(context, idea.projectId, idea.id, "medium");
      const issue = await prisma.bug.findUnique({ where: { id: converted.issueId }, select: { number: true } });
      issueNumber = issue?.number ?? null;
    } else {
      const reason = formData.get("reason")?.toString().trim() || formData.get("rejectReason")?.toString().trim() || null;
      await rejectIdea(context, idea.projectId, idea.id, reason);
    }
  } catch (error) {
    if (!(error instanceof IssueApiError)) console.error(`[idea-${decide}] failed`, error);
    redirect(`${ideaPath(refOf(idea.project), idea.number)}?error=${encodeURIComponent(error instanceof IssueApiError ? error.message : "Could not do that. Please try again.")}`);
  }
  revalidatePath("/[org]/[project]", "layout");
  redirect(issueNumber ? projectPath(refOf(idea.project), `/${issueNumber}`) : ideaPath(refOf(idea.project), idea.number));
}

export async function approveIdeaAction(formData: FormData): Promise<void> {
  await ideaDecision(formData, "approve");
}

export async function rejectIdeaAction(formData: FormData): Promise<void> {
  await ideaDecision(formData, "reject");
}
