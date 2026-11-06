import type { PrismaClient } from "@prisma/client";
import { issueHref } from "@/lib/issue-ref";
import { issueSwitchDestination } from "@/lib/issue-switch-destination";

/** Revalidate issue, membership and both archives before any cookie mutation. */
export async function resolveIssueWorkspaceSwitch(db: Pick<PrismaClient, "bug">, userId: string, input: {issueId: string; organisationId: string; returnTo?: unknown}) {
  if (!input.issueId || !input.organisationId || input.issueId.length > 191 || input.organisationId.length > 191) return null;
  const issue = await db.bug.findFirst({
    where: {id: input.issueId, organisationId: input.organisationId, isDeleted: false, project: {archivedAt: null}, organisation: {archivedAt: null, memberships: {some: {userId}}}},
    select: {organisationId: true, number: true, project: {select: {slug: true, organisation: {select: {slug: true}}}}},
  });
  return issue ? {organisationId: issue.organisationId, destination: issueSwitchDestination(issueHref(issue), input.returnTo)} : null;
}
