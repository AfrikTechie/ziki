import type { Difficulty } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { issueIdFor } from "@/lib/issue-ref";
import { DIFFICULTY_LOCKED, difficultyLabel } from "@/lib/difficulty";
import { hasLiveStake } from "@/lib/agent-api/stakes";

/**
 * `PATCH /api/v1/issues/{id}` with `difficulty` (#plan-review): any agent may
 * change an issue's difficulty until it takes its first bid; after that it is
 * fixed (409 `difficulty_locked`). The converting agent sets it at conversion;
 * this is the correction before anyone commits to the issue.
 */
export async function setDifficulty(agent: AgentContext, projectId: string, issueRef: string, difficulty: Difficulty) {
  requireLevel(agent, "working");
  return prisma.$transaction(async (tx) => {
    const bugId = await issueIdFor(tx, issueRef, agent.organisationId);
    const bug = bugId ? await tx.bug.findFirst({ where: { id: bugId, organisationId: agent.organisationId, projectId, isDeleted: false }, select: { id: true, difficulty: true, substatus: true, projectId: true } }) : null;
    if (!bug) throw new IssueApiError(404, "Issue not found in this project.");
    await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${bug.id} FOR UPDATE`;
    const bids = await tx.issueBid.count({ where: { bugId: bug.id } });
    if (bids > 0) throw new IssueApiError(409, DIFFICULTY_LOCKED.message, { ...DIFFICULTY_LOCKED, difficulty: bug.difficulty });
    if (bug.substatus !== "open" && bug.substatus !== "requires_confirmation") {
      throw new IssueApiError(409, "Difficulty can only change while the issue is Open.", { error: "not_open", difficulty: bug.difficulty });
    }
    // A live stake would win the issue with no plan: it decides the issue first (#stakes), so nothing becomes complex under it.
    if (await hasLiveStake(tx, bug.id)) {
      throw new IssueApiError(409, "This issue is staked: its difficulty can't change until the stake is decided.", { error: "issue_staked", difficulty: bug.difficulty });
    }
    if (bug.difficulty === difficulty) return { issueId: bug.id, difficulty, changed: false as const };
    await tx.bug.update({ where: { id: bug.id }, data: { difficulty } });
    await tx.bugActivity.create({
      data: { bugId: bug.id, actorId: agent.ownerId, type: "edited", summary: `set difficulty to ${difficultyLabel[difficulty]}`, metadata: { field: "difficulty", from: bug.difficulty, to: difficulty, agentId: agent.agentId } },
    });
    await publish(tx, {
      organisationId: agent.organisationId, type: "issue.updated", actorAgentId: agent.agentId, bugId: bug.id,
      payload: { issueId: bug.id, projectId: bug.projectId, field: "difficulty", from: bug.difficulty, to: difficulty },
    });
    return { issueId: bug.id, difficulty, changed: true as const };
  });
}
