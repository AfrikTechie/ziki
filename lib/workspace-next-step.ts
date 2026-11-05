import { isOrganizationAdmin, type OrganizationRole } from "@/lib/organization-role";
import { orgPath, type ProjectRef } from "@/lib/project-paths";
import type { GettingStartedStepId } from "@/lib/onboarding";
import type { AppRole } from "@/lib/roles";

/**
 * The next-step card (#agents-dock): where the empty agents bar used to be, one
 * short card that tells this person the single next thing to do, from their role
 * and what the workspace already has. Not an ad, and not tracking: only roles
 * and counts the app already reads. The card is for the workspace; the per-issue
 * "who acts next" bar is components/next-step-bar.tsx, a different thing.
 */

/** Dismissals are remembered per workspace, on this device, for a year, like the Getting started checklist's (lib/onboarding.ts). */
export const NEXT_STEP_COOKIE = "ziki_next_step_dismissed";
export const NEXT_STEP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type WorkspaceNextStepId = "connect-agent" | "create-agent" | "invite-teammate";

export type WorkspaceNextStep = {
  id: WorkspaceNextStepId;
  message: string;
  /** The primary pill. */
  cta: string;
  href: string;
  /** The Getting started step that says the same thing; the card stays away while that step is on the page. */
  checklistStep: GettingStartedStepId | null;
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
  /** The Getting started steps showing on this page that aren't done yet. */
  openChecklistSteps: GettingStartedStepId[];
};

/** The card to show, or null for none. One at a time. */
export function workspaceNextStep(input: WorkspaceNextStepInput): WorkspaceNextStep | null {
  if (input.dismissed || !input.membershipRole) return null;
  // Blocked agents are already covered by AgentSetupNotice: never a second card beside it.
  if (input.blockedAgentCount > 0) return null;

  const card = cardFor(input, input.membershipRole);
  if (!card) return null;
  // The checklist (owners and admins) already names this step: say it once.
  if (card.checklistStep && input.openChecklistSteps.includes(card.checklistStep)) return null;
  return card;
}

/** Which card this person's role and the workspace's counts call for, before dismissal and the checklist are considered. */
function cardFor(
  { slug, appRole, agentCount, memberCount, pendingInvites }: WorkspaceNextStepInput,
  membershipRole: OrganizationRole,
): WorkspaceNextStep | null {
  if (agentCount === 0) {
    return isOrganizationAdmin(membershipRole, appRole)
      ? {
          id: "connect-agent",
          message: "Your project is set up. Connect an agent to start filing and fixing issues.",
          cta: "Connect an agent",
          href: "/settings/connect",
          checklistStep: "agent",
        }
      : {
          id: "create-agent",
          message: "Earn by fixing issues here. Create an agent and it bids on work for you.",
          cta: "Create an agent",
          href: "/settings/connect",
          checklistStep: null,
        };
  }
  // Has agents: an owner on their own (no teammate, no invite out yet) is the one case left.
  if (membershipRole === "owner" && memberCount <= 1 && pendingInvites === 0) {
    return {
      id: "invite-teammate",
      message: "Invite a teammate so your agents' work gets reviewed.",
      cta: "Invite a teammate",
      href: orgPath(slug, "invites"),
      checklistStep: "invite",
    };
  }
  return null;
}
