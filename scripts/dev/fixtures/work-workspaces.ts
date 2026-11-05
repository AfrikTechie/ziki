/**
 * Two more workspaces for the Demo owner (demo@fixtures.local), to see the
 * issue list's Your Work and Live stages, which show only when they hold
 * issues:
 *
 *   Demo Work  (slug demo-work)  issues assigned to the Demo owner, nothing live yet
 *   Demo Live  (slug demo-live)  issues assigned to the Demo owner, and some live
 *
 * Each has the Demo owner as owner, one project, one set-up agent of theirs
 * that holds the claims, and a few issues in other states around them. Like
 * the Demo workspace they touch only their own rows (ids `fx-ws-*`) and a
 * rerun recreates them.
 */
import type { PrismaClient, Status, Substatus } from "@prisma/client";

type IssueSpec = { title: string; summary: string; status: Status; substatus: Substatus; claimed?: boolean };

type WorkspaceSpec = { key: string; slug: string; name: string; issues: IssueSpec[] };

const MINUTE = 60_000;

const WORK_ISSUES: IssueSpec[] = [
  { title: "[Bug] Saving a draft loses the selected area", summary: "The area picker resets to none after a draft is saved and reopened.", status: "in_progress", substatus: "in_progress", claimed: true },
  { title: "[Feature] Keyboard shortcut to open the search", summary: "Pressing / should focus the issue search from anywhere in the list.", status: "in_progress", substatus: "in_progress", claimed: true },
  { title: "[Bug] Avatar upload accepts files over the limit", summary: "Pictures larger than 1 MB upload and then fail to display.", status: "done", substatus: "requires_review", claimed: true },
  { title: "[Improvement] Show the deadline on claimed issues", summary: "The issue row doesn't say when the claimed work is due.", status: "open", substatus: "open" },
  { title: "[Bug] Notification count stays after reading", summary: "The bell keeps its badge after every notification has been read.", status: "open", substatus: "requires_confirmation" },
];

const LIVE_ISSUES: IssueSpec[] = [
  ...WORK_ISSUES,
  { title: "[Bug] Dark mode flashes white on load", summary: "The page renders light for a moment before switching to dark.", status: "resolved", substatus: "on_dev", claimed: true },
  { title: "[Feature] Export issues as CSV", summary: "Admins can download the issue list as a CSV file.", status: "resolved", substatus: "on_staging", claimed: true },
  { title: "[Bug] Long titles overflow the issue row", summary: "Titles over 120 characters push the status chips off screen.", status: "resolved", substatus: "on_prod", claimed: true },
];

const WORKSPACES: WorkspaceSpec[] = [
  { key: "work", slug: "demo-work", name: "Demo Work", issues: WORK_ISSUES },
  { key: "live", slug: "demo-live", name: "Demo Live", issues: LIVE_ISSUES },
];

export async function loadWorkWorkspaces(db: PrismaClient, ownerId: string, now: number): Promise<void> {
  for (const ws of WORKSPACES) {
    const tenantId = `fx-ws-${ws.key}-tenant`;
    const projectId = `fx-ws-${ws.key}-project`;
    const agentId = `fx-ws-${ws.key}-agent`;
    const existing = await db.tenant.findUnique({ where: { slug: ws.slug }, select: { id: true } });
    if (existing && existing.id !== tenantId) throw new Error(`A "${ws.slug}" workspace exists that the fixtures didn't make; not touching it.`);
    if (existing) {
      // Issues restrict deleting the workspace; everything else cascades.
      await db.bug.deleteMany({ where: { tenantId } });
      await db.tenant.delete({ where: { id: tenantId } });
    }

    await db.tenant.create({
      data: {
        id: tenantId,
        slug: ws.slug,
        name: ws.name,
        description: "Local fixtures: the Demo owner's assigned work (scripts/dev/fixtures/work-workspaces.ts).",
        nextIssueNumber: 1,
        nextIdeaNumber: 1,
        memberships: { create: { userId: ownerId, role: "owner" } },
        projects: { create: { id: projectId, slug: ws.slug, name: ws.name, workflow: { create: {} } } },
      },
    });
    // The owner's agent, set up so it may work, holds the claims.
    await db.agent.create({
      data: {
        id: agentId,
        tenantId,
        ownerUserId: ownerId,
        name: `${ws.name} Builder`,
        username: `${ws.slug}-builder`,
        level: "working",
        tagline: "Steady builder who finishes what it claims",
        about: "I pick up one issue at a time, reproduce it, fix it with a test, and deliver a small pull request.",
        createdAt: new Date(now - 30 * 24 * 60 * MINUTE),
      },
    });
    const tag = await db.skillTag.create({ data: { id: `fx-ws-${ws.key}-tag`, tenantId, name: "TypeScript", slug: "typescript" } });
    await db.agentSkill.create({ data: { agentId, tagId: tag.id, summary: "Strict types and small, tested fixes.", description: "I keep the types honest and add a test for every fix.", position: 0 } });

    // In number order: a trigger numbers issues from the workspace's counter.
    for (const [index, issue] of ws.issues.entries()) {
      const bugId = `fx-ws-${ws.key}-bug-${index + 1}`;
      const ago = (ws.issues.length - index) * 6 * 60;
      await db.bug.create({
        data: {
          id: bugId,
          tenantId,
          projectId,
          title: issue.title,
          summary: issue.summary,
          description: `## Summary\n\n${issue.summary}\n`,
          status: issue.status,
          substatus: issue.substatus,
          reporterId: ownerId,
          beneficiaryUserId: ownerId,
          assigneeId: issue.claimed ? ownerId : null,
          createdAt: new Date(now - ago * MINUTE),
        },
      });
      if (issue.claimed) {
        const claimedAt = new Date(now - (ago - 60) * MINUTE);
        const finished = issue.status === "resolved";
        await db.issueClaim.create({
          data: {
            id: `fx-ws-${ws.key}-claim-${index + 1}`,
            bugId,
            beneficiaryUserId: ownerId,
            agentId,
            status: "active",
            offeredAt: claimedAt,
            claimedAt,
            lastHeartbeatAt: new Date(now - 5 * MINUTE),
            deliverBy: new Date(now + 24 * 60 * MINUTE),
            // Live work is finished: its claim was let go when it resolved.
            ...(finished ? { status: "released" as const, releasedAt: new Date(now - 60 * MINUTE), releaseReason: "resolved" } : {}),
          },
        });
      }
    }
  }
}
