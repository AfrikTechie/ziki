import type { Prisma, PrismaClient, SecuritySeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SEVERITY_LABEL } from "@/lib/security-severity";
import { publish } from "@/lib/agent-api/events";

export { SECURITY_SEVERITIES, SEVERITY_GUIDE, SEVERITY_LABEL, isSecuritySeverity } from "@/lib/security-severity";

/**
 * Private security findings (#security-findings).
 *
 * A security report is filed like any other idea, but the idea (and the issue
 * it becomes) only ever carries a placeholder title and description. The real
 * title, summary, description and evidence files live in `SecurityFinding`.
 * Because the shared rows never hold the details, every surface that reads
 * ideas and issues (lists, search, the work feed, events, webhooks, emails)
 * shows the placeholder without needing its own check. Only the screens and
 * routes that call `canViewFinding` show the details.
 *
 * Who may see the details while the finding is private:
 * - the person who reported it (and their own agents),
 * - the workspace's owners and admins, and the site super admin,
 * - agents a workspace owner or admin cleared for security work.
 *
 * Once the fix is live (the issue reaches Live) the finding is disclosed: the
 * real text is copied onto the idea and the issue, and everyone can read it.
 * An owner or admin can also disclose it earlier.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** The title every idea and issue of a private finding carries instead of the real one. */
export function placeholderTitle(severity: SecuritySeverity): string {
  return `Private security finding (${SEVERITY_LABEL[severity]})`;
}

/** The description every idea and issue of a private finding carries instead of the real one. */
export const PLACEHOLDER_DESCRIPTION = [
  "This is a private security finding. Its details are visible only to the person who reported it, the workspace's owners and admins, and agents cleared for security work.",
  "",
  "They are published here automatically once the fix is live.",
].join("\n");

/** The summary every idea and issue of a private finding carries instead of the real one. */
export const PLACEHOLDER_SUMMARY = "Private security finding. The details are restricted until the fix is live.";

/** Who is asking. A person in the web app, or an agent through the API. */
export type FindingViewer =
  | { kind: "person"; userId: string; organisationId: string | null; organisationAdmin: boolean }
  | { kind: "agent"; ownerId: string; organisationId: string; securityCleared: boolean };

export type FindingAccessFields = { organisationId: string; reporterId: string; disclosedAt: Date | null };

/** The one rule for who may read a finding's details. */
export function canViewFinding(finding: FindingAccessFields, viewer: FindingViewer | null): boolean {
  if (finding.disclosedAt) return true;
  if (!viewer) return false;
  if (viewer.organisationId !== finding.organisationId) return false;
  if (viewer.kind === "person") return viewer.userId === finding.reporterId || viewer.organisationAdmin;
  return viewer.securityCleared || viewer.ownerId === finding.reporterId;
}

/** An agent as a finding viewer: its owner and whether it is cleared in this organisation. */
export async function agentFindingViewer(agent: { agentId: string; ownerId: string; organisationId: string }, db: Db = prisma): Promise<FindingViewer> {
  const row = await db.agentActivation.findUnique({
    where: { agentId_organisationId: { agentId: agent.agentId, organisationId: agent.organisationId } },
    select: { securityCleared: true },
  });
  return { kind: "agent", ownerId: agent.ownerId, organisationId: agent.organisationId, securityCleared: row?.securityCleared ?? false };
}

const findingSelect = {
  id: true,
  organisationId: true,
  projectId: true,
  ideaId: true,
  bugId: true,
  reporterId: true,
  severity: true,
  title: true,
  summary: true,
  description: true,
  disclosedAt: true,
  disclosedById: true,
  createdAt: true,
  attachments: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, filename: true, contentType: true, size: true, createdAt: true },
  },
} satisfies Prisma.SecurityFindingSelect;

export type FindingRow = Prisma.SecurityFindingGetPayload<{ select: typeof findingSelect }>;

/**
 * What a viewer is shown of a finding: always its severity and whether it is
 * private, and the details only when `canViewFinding` allows.
 */
export type FindingView = {
  id: string;
  severity: SecuritySeverity;
  disclosed: boolean;
  disclosedAt: Date | null;
  canView: boolean;
  details: null | {
    title: string;
    summary: string | null;
    description: string;
    attachments: FindingRow["attachments"];
  };
};

export function findingView(row: FindingRow, viewer: FindingViewer | null): FindingView {
  const canView = canViewFinding(row, viewer);
  return {
    id: row.id,
    severity: row.severity,
    disclosed: row.disclosedAt !== null,
    disclosedAt: row.disclosedAt,
    canView,
    details: canView ? { title: row.title, summary: row.summary, description: row.description, attachments: row.attachments } : null,
  };
}

export async function findingForBug(bugId: string, db: Db = prisma): Promise<FindingRow | null> {
  return db.securityFinding.findUnique({ where: { bugId }, select: findingSelect });
}

export async function findingForIdea(ideaId: string, db: Db = prisma): Promise<FindingRow | null> {
  return db.securityFinding.findUnique({ where: { ideaId }, select: findingSelect });
}

export type NewFinding = {
  organisationId: string;
  projectId: string;
  ideaId: string;
  reporterId: string;
  severity: SecuritySeverity;
  title: string;
  summary?: string | null;
  description: string;
};

/** Stores the private half of a new security report, next to its placeholder idea. */
export async function createFinding(db: Db, input: NewFinding): Promise<{ id: string }> {
  return db.securityFinding.create({
    data: {
      organisationId: input.organisationId,
      projectId: input.projectId,
      ideaId: input.ideaId,
      reporterId: input.reporterId,
      severity: input.severity,
      title: input.title,
      summary: input.summary ?? null,
      description: input.description,
    },
    select: { id: true },
  });
}

/**
 * Makes a finding public: copies its real title, summary and description onto
 * the idea and the issue, moves its evidence files onto them, and records when
 * and by whom. `byUserId` is null when it is disclosed because the fix went live.
 * Disclosing twice does nothing.
 */
export async function discloseFinding(db: Prisma.TransactionClient, findingId: string, byUserId: string | null): Promise<boolean> {
  const finding = await db.securityFinding.findUnique({
    where: { id: findingId },
    select: { id: true, organisationId: true, projectId: true, ideaId: true, bugId: true, severity: true, title: true, summary: true, description: true, disclosedAt: true },
  });
  if (!finding || finding.disclosedAt) return false;
  const text = { title: finding.title, summary: finding.summary, description: finding.description };
  if (finding.ideaId) await db.idea.update({ where: { id: finding.ideaId }, data: text });
  if (finding.bugId) await db.bug.update({ where: { id: finding.bugId }, data: text });
  await db.attachment.updateMany({
    where: { securityFindingId: finding.id },
    data: { ideaId: finding.ideaId, bugId: finding.bugId },
  });
  await db.securityFinding.update({ where: { id: finding.id }, data: { disclosedAt: new Date(), disclosedById: byUserId } });
  // Agents and webhooks hear that the details are public now (the text itself is on the issue).
  await publish(db, {
    organisationId: finding.organisationId,
    type: "security.disclosed",
    bugId: finding.bugId,
    projectId: finding.bugId ? null : finding.projectId,
    payload: {
      findingId: finding.id,
      issueId: finding.bugId,
      ideaId: finding.ideaId,
      severity: finding.severity,
      reason: byUserId ? "disclosed_early" : "fix_live",
      ...(byUserId ? { actor: { kind: "user", id: byUserId } } : {}),
    },
  });
  return true;
}

/**
 * Discloses every private finding whose issue is Live (#security-findings).
 * Runs with the platform sweeps and whenever the Security page loads, so a
 * finding goes public soon after its fix is live, whichever route made it Live.
 */
export async function discloseLiveFindings(options: { organisationId?: string } = {}, db: PrismaClient = prisma): Promise<number> {
  const due = await db.securityFinding.findMany({
    where: { disclosedAt: null, ...(options.organisationId ? { organisationId: options.organisationId } : {}), bug: { status: "resolved", isDeleted: false } },
    select: { id: true },
    take: 200,
  });
  let disclosed = 0;
  for (const row of due) {
    if (await db.$transaction((tx) => discloseFinding(tx, row.id, null))) disclosed += 1;
  }
  return disclosed;
}

/**
 * Whether an issue or idea is a finding that is still private. Their title and
 * description are placeholders, so the routes that rewrite them refuse: writing
 * the real text there would publish it.
 */
export async function isPrivateFinding(target: { bugId: string } | { ideaId: string }, db: Db = prisma): Promise<boolean> {
  const row = await db.securityFinding.findFirst({ where: { ...target, disclosedAt: null }, select: { id: true } });
  return row !== null;
}

export const PRIVATE_FINDING_EDIT_MESSAGE =
  "This is a private security finding: its title and description stay a placeholder until the fix is live, so they can't be edited here.";

/** How long a fixed finding took, from report to Live, in whole days (at least 0). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}
