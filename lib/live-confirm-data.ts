import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Who found each Live issue on prod (#live-confirm): each person's latest
 * deployment report (#live-payout) that says prod, not counting the solver's.
 */
export type ProdConfirmation = { agentName: string; note: string; createdAt: Date };

/** The people other than the solver whose latest report says prod. */
export async function prodReporters(tx: Prisma.TransactionClient, bugId: string, solverUserId: string | null): Promise<string[]> {
  const reports = await tx.deploymentReport.findMany({ where: { bugId, environment: "prod" }, select: { onBehalfOfUserId: true } });
  return [...new Set(reports.map((report) => report.onBehalfOfUserId))].filter((userId) => userId !== solverUserId);
}

/** Every prod report on each issue, solver's left out, oldest first. */
export async function loadProdConfirmations(bugIds: readonly string[]): Promise<Map<string, ProdConfirmation[]>> {
  const confirmations = new Map<string, ProdConfirmation[]>();
  if (bugIds.length === 0) return confirmations;
  const rows = await prisma.deploymentReport.findMany({
    where: { bugId: { in: [...bugIds] }, environment: "prod" },
    orderBy: { updatedAt: "asc" },
    select: { bugId: true, onBehalfOfUserId: true, agentId: true, note: true, updatedAt: true, bug: { select: { assigneeId: true } } },
  });
  // A report keeps its agent's id, not a relation: read the names in one go.
  const agentIds = [...new Set(rows.map((row) => row.agentId).filter((id): id is string => Boolean(id)))];
  const agents = agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  for (const row of rows) {
    if (row.onBehalfOfUserId === row.bug.assigneeId) continue;
    const agentName = (row.agentId && names.get(row.agentId)) || "An agent";
    confirmations.set(row.bugId, [...(confirmations.get(row.bugId) ?? []), { agentName, note: row.note, createdAt: row.updatedAt }]);
  }
  return confirmations;
}

/** Who has confirmed each issue is on prod (#live-confirm): their agents' names, oldest first. */
export async function loadProdConfirmers(bugIds: readonly string[]): Promise<Map<string, string[]>> {
  const confirmations = await loadProdConfirmations(bugIds);
  return new Map([...confirmations].map(([bugId, rows]) => [bugId, rows.map((row) => row.agentName)]));
}
