import type { PrismaClient } from "@prisma/client";
import { newIssuePath, orgPath, type ProjectRef } from "@/lib/project-paths";

/**
 * The "getting started" checklist a new workspace's owner sees on the issues
 * page (#641) until every step is done or they dismiss it.
 */

export const GETTING_STARTED_COOKIE = "ziki_getting_started_dismissed";
/** Dismissals are remembered per workspace, on this device, for a year. */
export const GETTING_STARTED_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Most workspace ids the cookie keeps, so it can't grow without bound. */
const MAX_DISMISSED = 50;

export type GettingStartedStepId = "workspace" | "project" | "issue" | "invite" | "agent";

export type GettingStartedStep = {
  id: GettingStartedStepId;
  label: string;
  hint: string;
  href: string;
  done: boolean;
};

type Db = Pick<PrismaClient, "project" | "bug" | "membership" | "tenantInvite" | "agent">;

/** The steps for one workspace, from five cheap counts. */
export async function gettingStartedFor(
  db: Db,
  tenantId: string,
  /** The project the checklist is shown in, for its links (#project-urls). */
  slug: ProjectRef,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ steps: GettingStartedStep[]; complete: boolean }> {
  const [projects, issues, members, pendingInvites, agents] = await Promise.all([
    db.project.count({ where: { tenantId } }),
    db.bug.count({ where: { tenantId, isDeleted: false } }),
    db.membership.count({ where: { tenantId } }),
    db.tenantInvite.count({ where: { tenantId, acceptedAt: null, expiresAt: { gt: now } } }),
    // The workspace's agents (anyone's, not revoked): the step is about the workspace having one.
    db.agent.count({ where: { tenantId, revokedAt: null } }),
  ]);
  const steps: GettingStartedStep[] = [
    {
      id: "workspace",
      label: "Create your workspace",
      hint: "Your team's own space for projects, issues and people.",
      href: "/tenants",
      done: true,
    },
    {
      id: "project",
      label: "Set up a project",
      hint: "One product you track, such as a web app.",
      href: orgPath(slug, "projects"),
      done: projects > 0,
    },
    {
      id: "issue",
      label: "Report the first issue",
      hint: "Say what you expected, what happened instead, and how to make it happen again.",
      href: newIssuePath(slug),
      done: issues > 0,
    },
    {
      id: "invite",
      label: "Invite a teammate",
      hint: "Send an email invite or share an invite link from the organization's Invites tab.",
      href: orgPath(slug, "invites"),
      done: members > 1 || pendingInvites > 0,
    },
    {
      id: "agent",
      label: "Connect your first agent",
      hint: "An agent files issues, bids on work and delivers fixes for you. Connect one from Settings.",
      href: "/settings/connect",
      done: agents > 0,
    },
  ];
  // The list is done when the four steps it always had are. The agent step was added later, so a workspace that
  // had already finished the list doesn't see it come back for want of an agent (the next-step card covers that).
  const complete = steps.filter((step) => step.id !== "agent").every((step) => step.done);
  return { steps, complete };
}

/** Workspace ids whose checklist was dismissed on this device. */
export function parseDismissed(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))
    .slice(-MAX_DISMISSED);
}

/** The cookie value after dismissing `tenantId`, newest last, capped. */
export function withDismissed(value: string | null | undefined, tenantId: string): string {
  const ids = parseDismissed(value).filter((id) => id !== tenantId);
  ids.push(tenantId);
  return ids.slice(-MAX_DISMISSED).join(",");
}
