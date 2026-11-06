import { z } from "zod";
import { audit } from "@/lib/agents/audit";
import { IssueApiError } from "@/lib/agent-api/errors";
import { publish } from "@/lib/agent-api/events";
import { parseIssueRef } from "@/lib/issue-ref";
import { trackRules } from "@/lib/marketing/track";
import { prisma } from "@/lib/prisma";

/**
 * The optional link from a marketing issue to one related product issue in the
 * same project (D6, M-API-12). Any agent may set or clear it.
 */
export const linkedIssueSchema = z
  .object({
    /** The product issue, by id or number. */
    issueId: z.string().trim().min(1).max(191),
    projectId: z.string().trim().min(1).max(191).optional(),
  })
  .strict();

const NOT_FOUND = "No such issue in this project.";
const FROM_MARKETING_ONLY = "Only a marketing issue links to a product issue.";
const TO_PRODUCT_ONLY = "A marketing issue links to a product issue, not to another marketing issue.";

type Agent = { agentId: string; organisationId: string };
type Scope = { organisationId: string; projectId: string };
type Linked = { id: string; number: number; title: string };

const refWhere = (raw: string) => {
  const ref = parseIssueRef(raw);
  return ref.kind === "number" ? { number: ref.number } : { id: ref.id };
};

function wrongTrack(message: string): IssueApiError {
  return new IssueApiError(409, message, { error: "wrong_track", message });
}

/** Sets or clears the link (`target` null), and answers with what it is now. */
async function writeLink(agent: Agent, scope: Scope, issueRef: string, target: string | null) {
  return prisma.$transaction(async (tx) => {
    const bug = await tx.bug.findFirst({
      where: { ...scope, isDeleted: false, ...refWhere(issueRef) },
      select: { id: true, track: true, linkedIssueId: true },
    });
    if (!bug) throw new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
    if (trackRules(bug.track).hasProductSteps) throw wrongTrack(FROM_MARKETING_ONLY);

    let linked: Linked | null = null;
    if (target !== null) {
      const found = await tx.bug.findFirst({
        where: { ...scope, isDeleted: false, ...refWhere(target) },
        select: { id: true, number: true, title: true, track: true },
      });
      if (!found) throw new IssueApiError(404, NOT_FOUND, { error: "not_found", message: NOT_FOUND });
      if (!trackRules(found.track).hasProductSteps) throw wrongTrack(TO_PRODUCT_ONLY);
      linked = { id: found.id, number: found.number, title: found.title };
    }

    const changed = bug.linkedIssueId !== (linked?.id ?? null);
    if (changed) {
      await tx.bug.update({ where: { id: bug.id }, data: { linkedIssueId: linked?.id ?? null } });
      const payload = { issueId: bug.id, from: bug.linkedIssueId, to: linked?.id ?? null };
      await audit({ agentId: agent.agentId, organisationId: scope.organisationId }, "issue.linked_issue_changed", `bug:${bug.id}`, payload, { bugId: bug.id, db: tx });
      await publish(tx, { organisationId: scope.organisationId, type: "issue.updated", actorAgentId: agent.agentId, bugId: bug.id, payload });
    }
    return { issueId: bug.id, linkedIssue: linked, changed };
  });
}

export function setLinkedIssue(agent: Agent, scope: Scope, issueRef: string, target: string) {
  return writeLink(agent, scope, issueRef, target);
}

export function clearLinkedIssue(agent: Agent, scope: Scope, issueRef: string) {
  return writeLink(agent, scope, issueRef, null);
}
