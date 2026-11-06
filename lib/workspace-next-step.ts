import { isOrganizationAdmin, type OrganizationRole } from "@/lib/organization-role";
import type { ProjectRef } from "@/lib/project-paths";
import type { AppRole } from "@/lib/roles";

/**
 * The next-step card (#agents-dock): where the empty agents bar used to be, one
 * short card that tells this person the single next thing to do, from their role
 * and what the workspace already has. Not an ad, and not tracking: only roles
 * and counts the app already reads. The card is for the workspace; the per-issue
 * "who acts next" bar is components/next-step-bar.tsx, a different thing.
 */

/** Dismissals are remembered per workspace, on this device, for a year (lib/onboarding.ts). */
export const NEXT_STEP_COOKIE = "ziki_next_step_dismissed";
export const NEXT_STEP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type WorkspaceNextStepId = "connect-agent" | "create-agent" | "invite-teammate";

export type WorkspaceNextStep = {
  id: WorkspaceNextStepId;
  message: string;
  /** The primary pill. */
  cta: string;
  href: string;
};

export type WorkspaceNextStepInput = {
  /** The project the card is shown in, for its links (#project-urls). */
  slug: ProjectRef;
  /** The person's role in this workspace; null when they aren't a member of it. */
  membershipRole: OrganizationRole | null;
  appRole?: AppRole | null;
  /** The person's own agents in this workspace (not revoked). */
  agentCount: number;
  /** Of those, the ones that can't work yet because their profile isn't set up (AgentSetupNotice). */
  blockedAgentCount: number;
  memberCount: number;
  pendingInvites: number;
  /** This workspace's card was dismissed on this device. */
  dismissed: boolean;
};

/** The card to show, or null for none. One at a time. */
export function workspaceNextStep(input: WorkspaceNextStepInput): WorkspaceNextStep | null {
  if (input.dismissed || !input.membershipRole) return null;
  // Blocked agents are already covered by AgentSetupNotice: never a second card beside it.
  if (input.blockedAgentCount > 0) return null;

  return cardFor(input, input.membershipRole);
}

/** Which card this person's role and the workspace's counts call for, before dismissal is considered. */
function cardFor(
  { appRole, agentCount }: WorkspaceNextStepInput,
  membershipRole: OrganizationRole,
): WorkspaceNextStep | null {
  if (agentCount === 0) {
    return isOrganizationAdmin(membershipRole, appRole)
      ? {
          id: "connect-agent",
          message: "Your project is set up. Connect an agent to start filing and fixing issues.",
          cta: "Connect an agent",
          href: "/settings/connect",
        }
      : {
          id: "create-agent",
          message: "Earn by fixing issues here. Create an agent and it bids on work for you.",
          cta: "Create an agent",
          href: "/settings/connect",
        };
  }
  return null;
}
