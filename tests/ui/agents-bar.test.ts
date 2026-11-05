import { describe, expect, it } from "vitest";
import { dockVisibleOn, leaderboardInMenu, leaderboardVisible } from "@/lib/agents-dock";
import { projectRef } from "@/lib/project-paths";
import { gettingStartedFor, parseDismissed, withDismissed } from "@/lib/onboarding";
import { NEXT_STEP_COOKIE, workspaceNextStep, type WorkspaceNextStepInput } from "@/lib/workspace-next-step";

const ref = projectRef("zedu", "acme");

/**
 * The agents bar (#agents-dock): which pages draw it, when the Leaderboard
 * link is worth showing, the Getting started agent step, and the one next step
 * a workspace card names in place of the empty bar. Pure rules.
 */

describe("dockVisibleOn: where the agents bar shows", () => {
  it.each([
    "/zedu/acme",
    "/zedu/acme/ideas",
    "/zedu/acme/ideas/drafts",
    "/zedu/acme/ideas/rejected",
    "/zedu/acme/ideas/7",
    "/zedu/acme/issues",
    "/zedu/acme/issues/open",
    "/zedu/acme/issues/new",
    "/zedu/acme/42",
    "/zedu/acme/workstream",
    "/zedu/acme/work",
    "/inbox",
    "/inbox/escalations/abc",
    "/home",
    "/activity",
    "/feed",
  ])("shows on %s when you have agents", (path) => {
    expect(dockVisibleOn(path, 1)).toBe(true);
    expect(dockVisibleOn(path, 3)).toBe(true);
  });

  it.each(["/agents/mine", "/agent/robo", "/agent/robo/edit", "/agent/robo/edit/look"])(
    "hides on the page that manages agents: %s",
    (path) => {
      expect(dockVisibleOn(path, 2)).toBe(false);
    },
  );

  it.each(["/settings/connect", "/settings/agents/connect", "/settings/agents/pair"])(
    "hides while creating or approving an agent: %s",
    (path) => {
      expect(dockVisibleOn(path, 2)).toBe(false);
    },
  );

  it.each([
    "/settings",
    "/settings/profile",
    "/settings/agents",
    "/settings/agent/robo",
    "/projects/acme/settings",
    "/zedu/acme/org",
    "/zedu/acme/org/members",
    "/zedu/acme/org/invites",
    "/superadmin",
    "/superadmin/users",
    "/superadmin/orgs/acme",
    "/tenants",
    "/tenants/invite/abc",
    "/security",
    "/points/disputes",
    "/points/disputes/new",
  ])("hides on settings and admin: %s", (path) => {
    expect(dockVisibleOn(path, 2)).toBe(false);
  });

  it.each(["/docs", "/agents", "/agents/skill/react", "/workers"])("hides on reading pages: %s", (path) => {
    expect(dockVisibleOn(path, 2)).toBe(false);
  });

  it("hides everywhere when you have no agents", () => {
    for (const path of ["/zedu/acme", "/zedu/acme/issues", "/zedu/acme/42", "/zedu/acme/workstream", "/inbox", "/home", "/activity", "/feed", "/agents/mine", "/settings", "/docs"]) {
      expect(dockVisibleOn(path, 0)).toBe(false);
    }
  });

  it("matches whole path segments, not prefixes", () => {
    // A project called "organic" or "settings-ui" is a project: its pages are work pages.
    expect(dockVisibleOn("/zedu/organic/issues", 1)).toBe(true);
    expect(dockVisibleOn("/zedu/settings-ui/issues", 1)).toBe(true);
    // Only the named sections count: not a look-alike, and not a page below one that isn't named.
    expect(dockVisibleOn("/zedu/acme/ideasx", 1)).toBe(false);
    expect(dockVisibleOn("/zedu/acme/issuesx", 1)).toBe(false);
    expect(dockVisibleOn("/zedu/acme/42x", 1)).toBe(false);
    expect(dockVisibleOn("/zedu/acme/organisation", 1)).toBe(false);
    expect(dockVisibleOn("/homepage", 1)).toBe(false);
    // Home, feed and activity are those pages only, not what sits below them.
    expect(dockVisibleOn("/home/extra", 1)).toBe(false);
    expect(dockVisibleOn("/feed/x", 1)).toBe(false);
    expect(dockVisibleOn("/activity/x", 1)).toBe(false);
    // A project that happens to be called "feeds" is a project: its landing page is a work page.
    expect(dockVisibleOn("/zedu/feeds", 1)).toBe(true);
    // Under issues, whatever it is.
    expect(dockVisibleOn("/zedu/acme/issues/org", 1)).toBe(true);
  });

  it("ignores a trailing slash", () => {
    expect(dockVisibleOn("/agents/mine/", 1)).toBe(false);
    expect(dockVisibleOn("/zedu/acme/issues/", 1)).toBe(true);
    expect(dockVisibleOn("/home/", 1)).toBe(true);
  });

  it.each(["/earn", "/earn/", "/earn/tasks", "/earn/earnings", "/earn/marketing/12", "/earn/withdraw"])(
    "keeps the bar on earn pages for earners with agents: %s",
    (path) => {
      expect(dockVisibleOn(path, 1)).toBe(true);
      expect(dockVisibleOn(path, 3)).toBe(true);
    },
  );

  it.each(["/earn", "/earn/tasks", "/earn/earnings"])("hides on earn pages when there are no agents: %s", (path) => {
    expect(dockVisibleOn(path, 0)).toBe(false);
  });

  it("matches earn on the whole segment: a look-alike isn't earn", () => {
    expect(dockVisibleOn("/earning/tasks", 1)).toBe(false);
    expect(dockVisibleOn("/zedu/earnings", 1)).toBe(true); // a project that happens to be called "earnings": its landing page
    expect(dockVisibleOn("/zedu/earnings/notes", 1)).toBe(false);
  });

  it.each([
    "/questions",
    "/questions/abc",
    "/users/abc",
    "/team",
    "/milestones",
    "/jobs",
    "/marketing",
    "/redesigns",
    "/redesigns/abc",
    "/leaderboard",
    "/zedu/acme/notes",
    "/zedu/acme/notes/agents/robo",
    "/zedu/acme/tasks/3",
    "/zedu/acme/projects",
    "/zedu/acme/42/history",
    "/zedu/acme/something-new",
    "/",
  ])("hides on a page the allowlist doesn't name: %s", (path) => {
    expect(dockVisibleOn(path, 1)).toBe(false);
    expect(dockVisibleOn(path, 5)).toBe(false);
  });

  it("hides on an organisation's list of projects", () => {
    expect(dockVisibleOn("/zedu", 2)).toBe(false);
    expect(dockVisibleOn("/zedu/", 2)).toBe(false);
  });

  it.each(["/acme/ideas", "/acme/issues/open", "/acme/42", "/acme/workstream", "/acme/work"])(
    "hides on an old project-first address while it redirects: %s",
    (path) => {
      expect(dockVisibleOn(path, 2)).toBe(false);
    },
  );

  it("hides when the path is unknown", () => {
    expect(dockVisibleOn(null, 1)).toBe(false);
    expect(dockVisibleOn(undefined, 1)).toBe(false);
    expect(dockVisibleOn(undefined, 0)).toBe(false);
  });
});

describe("leaderboardVisible: you can't be the only person on a leaderboard", () => {
  it("hides it for a one-member workspace", () => {
    expect(leaderboardVisible(1)).toBe(false);
    expect(leaderboardVisible(0)).toBe(false);
  });

  it("shows it once there is more than one member", () => {
    expect(leaderboardVisible(2)).toBe(true);
    expect(leaderboardVisible(40)).toBe(true);
  });

  it("keeps it when the count could not be loaded", () => {
    expect(leaderboardVisible(null)).toBe(true);
    expect(leaderboardVisible(undefined)).toBe(true);
  });
});

describe("leaderboardInMenu: the account menu only offers what the bar isn't showing", () => {
  it("is in the menu when the bar isn't drawn (no agents, or a page that hides it)", () => {
    expect(leaderboardInMenu("/zedu/acme/issues", 0, 5)).toBe(true);
    expect(leaderboardInMenu("/settings", 2, 5)).toBe(true);
    expect(leaderboardInMenu("/agents/mine", 2, 5)).toBe(true);
  });

  it("is left out when the bar is showing it", () => {
    expect(leaderboardInMenu("/zedu/acme/issues", 1, 5)).toBe(false);
    expect(leaderboardInMenu("/home", 3, 2)).toBe(false);
  });

  it("is never offered in a workspace of one member, bar or no bar", () => {
    expect(leaderboardInMenu("/zedu/acme/issues", 0, 1)).toBe(false);
    expect(leaderboardInMenu("/settings", 2, 1)).toBe(false);
  });

  it("is offered when the member count is unknown and the bar isn't there", () => {
    expect(leaderboardInMenu("/settings", 0, null)).toBe(true);
    expect(leaderboardInMenu("/zedu/acme/issues", 1, null)).toBe(false);
  });
});

type AgentRow = { tenantId: string; ownerUserId: string; revokedAt: Date | null };

/** A small fake database: the four counts the checklist always reads, and the agents it filters. */
function checklistDb({ agents = [] as AgentRow[], members = 1, projects = 1, issues = 0, invites = 0 } = {}) {
  return {
    project: { count: async () => projects },
    bug: { count: async () => issues },
    membership: { count: async () => members },
    tenantInvite: { count: async () => invites },
    agent: {
      count: async ({ where }: { where: { tenantId: string; revokedAt: null } }) =>
        agents.filter((a) => a.tenantId === where.tenantId && a.revokedAt === where.revokedAt).length,
    },
  } as unknown as Parameters<typeof gettingStartedFor>[0];
}

describe("Getting started: Connect your first agent", () => {
  const mine: AgentRow = { tenantId: "t1", ownerUserId: "owner", revokedAt: null };
  /** Everything the list always asked for is done: a project, an issue and a teammate. */
  const original = { members: 2, issues: 3 };

  it("adds a 5th step after the four that were there, open until the workspace has an agent", async () => {
    const { steps } = await gettingStartedFor(checklistDb(), "t1", ref);
    expect(steps.map((step) => step.id)).toEqual(["workspace", "project", "issue", "invite", "agent"]);
    const agent = steps[4]!;
    expect(agent.label).toBe("Connect your first agent");
    expect(agent.href).toBe("/settings/connect");
    expect(agent.done).toBe(false);
  });

  it("ticks once the workspace has an agent, whoever owns it", async () => {
    const { steps } = await gettingStartedFor(checklistDb({ agents: [mine] }), "t1", ref);
    expect(steps.find((step) => step.id === "agent")?.done).toBe(true);
    const teammates = { ...mine, ownerUserId: "teammate" };
    const other = await gettingStartedFor(checklistDb({ agents: [teammates] }), "t1", ref);
    expect(other.steps.find((step) => step.id === "agent")?.done).toBe(true);
  });

  it("does not count a revoked agent or another workspace's", async () => {
    const agents: AgentRow[] = [{ ...mine, revokedAt: new Date("2026-01-01") }, { ...mine, tenantId: "t2" }];
    const { steps } = await gettingStartedFor(checklistDb({ agents }), "t1", ref);
    expect(steps.find((step) => step.id === "agent")?.done).toBe(false);
  });

  it("stays hidden for a list that was already complete: no agent doesn't bring it back", async () => {
    const { steps, complete } = await gettingStartedFor(checklistDb(original), "t1", ref);
    expect(steps.find((step) => step.id === "agent")?.done).toBe(false);
    expect(complete).toBe(true);
    // Done the same way when the agent is there too.
    expect((await gettingStartedFor(checklistDb({ ...original, agents: [mine] }), "t1", ref)).complete).toBe(true);
  });

  it("is still open while any of the four original steps is, agent or not", async () => {
    expect((await gettingStartedFor(checklistDb({ agents: [mine] }), "t1", ref)).complete).toBe(false);
    expect((await gettingStartedFor(checklistDb({ members: 2 }), "t1", ref)).complete).toBe(false);
    expect((await gettingStartedFor(checklistDb({ issues: 1, invites: 0 }), "t1", ref)).complete).toBe(false);
    // A pending invite counts as the teammate step, as before.
    expect((await gettingStartedFor(checklistDb({ issues: 1, invites: 1 }), "t1", ref)).complete).toBe(true);
  });
});

describe("workspaceNextStep: the one next thing, from who you are", () => {
  const base: WorkspaceNextStepInput = {
    slug: ref,
    membershipRole: "owner",
    appRole: "user",
    agentCount: 0,
    blockedAgentCount: 0,
    memberCount: 3,
    pendingInvites: 0,
    dismissed: false,
    openChecklistSteps: [],
  };
  const ask = (over: Partial<WorkspaceNextStepInput>) => workspaceNextStep({ ...base, ...over });

  it("tells an owner with no agents to connect one", () => {
    const card = ask({});
    expect(card?.id).toBe("connect-agent");
    expect(card?.message).toBe("Your project is set up. Connect an agent to start filing and fixing issues.");
    expect(card?.cta).toBe("Connect an agent");
    expect(card?.href).toBe("/settings/connect");
  });

  it("tells an admin the same", () => {
    expect(ask({ membershipRole: "admin" })?.id).toBe("connect-agent");
  });

  it("tells a member with no agents to create one and earn", () => {
    const card = ask({ membershipRole: "member" });
    expect(card?.id).toBe("create-agent");
    expect(card?.message).toBe("Earn by fixing issues here. Create an agent and it bids on work for you.");
    expect(card?.cta).toBe("Create an agent");
    expect(card?.href).toBe("/settings/connect");
  });

  it("leaves it to AgentSetupNotice when an agent is blocked: no second card", () => {
    expect(ask({ agentCount: 1, blockedAgentCount: 1, memberCount: 1 })).toBeNull();
    expect(ask({ agentCount: 2, blockedAgentCount: 2, membershipRole: "member" })).toBeNull();
  });

  it("tells the owner of a solo workspace, with agents, to invite a teammate", () => {
    const card = ask({ agentCount: 1, memberCount: 1 });
    expect(card?.id).toBe("invite-teammate");
    expect(card?.message).toBe("Invite a teammate so your agents' work gets reviewed.");
    expect(card?.href).toBe("/zedu/acme/org/invites");
  });

  it("says nothing to an owner with agents once the workspace has company or a pending invite", () => {
    expect(ask({ agentCount: 1, memberCount: 2 })).toBeNull();
    expect(ask({ agentCount: 1, memberCount: 1, pendingInvites: 1 })).toBeNull();
  });

  it("says nothing to a member or admin with agents", () => {
    expect(ask({ agentCount: 1, memberCount: 1, membershipRole: "member" })).toBeNull();
    expect(ask({ agentCount: 1, memberCount: 1, membershipRole: "admin" })).toBeNull();
  });

  it("says nothing when you aren't a member of the workspace", () => {
    expect(ask({ membershipRole: null })).toBeNull();
  });

  it("stays away once dismissed", () => {
    expect(ask({ dismissed: true })).toBeNull();
    expect(ask({ dismissed: true, membershipRole: "member" })).toBeNull();
    expect(ask({ dismissed: true, agentCount: 1, memberCount: 1 })).toBeNull();
  });

  it("never repeats a step the Getting started checklist is showing", () => {
    expect(ask({ openChecklistSteps: ["invite", "agent"] })).toBeNull();
    expect(ask({ agentCount: 1, memberCount: 1, openChecklistSteps: ["invite"] })).toBeNull();
    // A step the checklist has ticked is no longer on the page.
    expect(ask({ openChecklistSteps: ["invite"] })?.id).toBe("connect-agent");
    // The member card has no checklist step: members never see the checklist.
    expect(ask({ membershipRole: "member", openChecklistSteps: ["agent"] })?.id).toBe("create-agent");
  });

  it("treats the site super admin as an admin of the workspace, as the checklist does", () => {
    expect(ask({ membershipRole: "member", appRole: "super_admin" })?.id).toBe("connect-agent");
  });
});

describe("the next-step card's dismissal cookie", () => {
  it("is its own cookie, kept per workspace like the checklist's", () => {
    expect(NEXT_STEP_COOKIE).not.toBe("ziki_getting_started_dismissed");
    const once = withDismissed(undefined, "t1");
    const twice = withDismissed(once, "t2");
    expect(parseDismissed(twice)).toEqual(["t1", "t2"]);
    expect(parseDismissed(withDismissed(twice, "t1"))).toEqual(["t2", "t1"]);
  });
});
