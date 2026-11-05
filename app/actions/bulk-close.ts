"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { awardingAgentOf } from "@/lib/bid-award-permission";
import { closeIssue, closeTally, suggestClose } from "@/lib/agent-api/close-suggestions";
import { IssueApiError } from "@/lib/agent-api/errors";
import { workflowFor } from "@/lib/workflow";
import { VOTED_CLOSE_REASONS, type VotedCloseReason } from "@/lib/close-reasons";
import { projectPath, refOf } from "@/lib/project-paths";

/**
 * The reviewed bulk close (#bulk-close): a manager picks the issues they
 * checked, each with its reason, summary and evidence, and closes them
 * together. It is the same two steps as one issue, run for each: the
 * manager's agent suggests closing it (a weighted vote), and the issue closes
 * once the votes for that reason reach the project's threshold. Nothing skips
 * the votes; an issue still short of the threshold keeps the suggestion and
 * stays open.
 */
export async function bulkCloseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const project = await prisma.project.findFirst({ where: { id: projectId, slug }, select: { id: true, tenantId: true, slug: true, tenant: { select: { slug: true } } } });
  if (!project) redirect("/home");
  const back = projectPath(refOf(project), "/issues/bulk-close");
  const agent = await awardingAgentOf(user.id, project.tenantId);
  if (!agent || (agent.level !== "manager" && agent.level !== "merger")) {
    redirect(`${back}?error=${encodeURIComponent("Only a person with a manager agent can close issues.")}`);
  }
  const context = { agentId: agent.id, name: agent.name, ownerId: agent.ownerUserId, tenantId: agent.tenantId, level: agent.level, burst: false, keyId: "web" };
  const { closeThreshold } = await workflowFor(project.id);

  const picked = formData.getAll("issue").map(String).filter(Boolean);
  let closed = 0;
  let waiting = 0;
  const failed: string[] = [];
  for (const id of picked) {
    const reasonRaw = String(formData.get(`reason:${id}`) ?? "");
    const reason = (VOTED_CLOSE_REASONS as readonly string[]).includes(reasonRaw) ? (reasonRaw as VotedCloseReason) : null;
    const summary = String(formData.get(`summary:${id}`) ?? "").trim();
    const evidence = String(formData.get(`evidence:${id}`) ?? "").trim();
    const number = String(formData.get(`number:${id}`) ?? id);
    if (!reason || reason === "duplicate" || !summary || !evidence) {
      failed.push(`#${number}: give a reason (not duplicate), a summary and the evidence`);
      continue;
    }
    try {
      await suggestClose(context, project.id, id, { reason, summary, evidence });
      if ((await closeTally(id, reason)) >= closeThreshold) {
        await closeIssue(context, project.id, id, { reason, evidence });
        closed += 1;
      } else waiting += 1;
    } catch (error) {
      failed.push(`#${number}: ${error instanceof IssueApiError ? error.message : "could not be closed"}`);
      if (!(error instanceof IssueApiError)) console.error("[bulk-close] failed", error);
    }
  }
  revalidatePath("/[org]/[project]", "layout");
  const params = new URLSearchParams({ closed: String(closed), waiting: String(waiting) });
  if (failed.length) params.set("error", failed.join("; "));
  redirect(`${back}?${params}`);
}
