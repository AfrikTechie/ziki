import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import { isLinkPreviewBot } from "@/lib/link-preview";
import { isPublicAgentPath } from "@/lib/public-agent-paths";
import { AppHeader } from "@/components/app-header";
import { getUnreadCount } from "@/lib/lookups";
import { REPORT_FORM_URL } from "@/lib/report-form";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/skip-link";
import { PAGE_CONTAINER_CLASS } from "@/components/page-container";
import { FocusMainOnNavigate } from "@/components/focus-main-on-navigate";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { isOrganizationAdmin, type OrganizationRole } from "@/lib/organization-role";
import type { WorkspaceChoice } from "@/components/workspace-switcher";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { firstProjectRefFor } from "@/lib/project-route";
import { tenantsForUser } from "@/lib/tenants";
import { countPendingEscalations } from "@/lib/agent-questions";
import { loadOwnAgents } from "@/lib/dashboard-overview";
import { AgentsDock, type DockAgent } from "@/components/agents-dock";
import { appVersionLabel } from "@/lib/deployed-version";
import { agentActivity, agentEarnings } from "@/lib/points/agent-earnings";
import { earnBalanceFor, showEarnWelcome } from "@/lib/earn/state";
import { EarnWelcomeToast } from "@/components/earn-welcome-toast";
import { isEarnPath } from "@/lib/earn/paths";
import { withdrawInfo } from "@/lib/earn/draft";
import { earnWorkspace } from "@/lib/earn/earner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Link-preview crawlers may reach /bugs/[id] without a session. Render a
  // minimal shell so generateMetadata + the public preview body can respond.
  if (!session?.user) {
    const ua = (await headers()).get("user-agent");
    if (isLinkPreviewBot(ua)) {
      return (
        <div className="flex min-h-screen flex-col bg-background">
          <main
            id={MAIN_CONTENT_ID}
            className={`${PAGE_CONTAINER_CLASS} flex-1 py-8`}
          >
            {children}
          </main>
        </div>
      );
    }
  }

  // #agent-profile: a guest on a public agent page (a profile, the directory)
  // gets a plain shell with a way to sign in, not the sign-in redirect.
  if (!session?.user && isPublicAgentPath((await headers()).get("x-ziki-path") ?? "")) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header className="border-b border-zk-border bg-zk-surface">
          <div className={`${PAGE_CONTAINER_CLASS} flex items-center justify-between py-3`}>
            <Link href="/" className="text-lg font-extrabold tracking-tight text-zk-text">
              Ziki
            </Link>
            <Link href="/login" className="text-sm font-bold text-zk-accent hover:underline">
              Sign in
            </Link>
          </div>
        </header>
        <main id={MAIN_CONTENT_ID} className={`${PAGE_CONTAINER_CLASS} flex-1 py-8`}>
          {children}
        </main>
      </div>
    );
  }

  const user = await requireUser();
  // Earn (#earn-landing): connecting an agent (/earn/agent) is a page of its own: no header, agents bar or footer around it.
  const requestPath = (await headers()).get("x-ziki-path") ?? "";
  // The first time someone opens an earn page in a browser, new account or old: a note that the $5 is in.
  const welcomeNotice = isEarnPath(requestPath) ? await showEarnWelcome(user.id).catch(() => false) : false;
  // The header lists this person's workspaces. Pages still resolve the active
  // project inside the current workspace, so a foreign project id is ignored.
  let workspaces: WorkspaceChoice[] = [];
  let activeTenantId: string | null = null;
  let tenantId: string | null = null;
  let membershipRole: OrganizationRole | null = null;
  try {
    tenantId = await currentTenantIdFor(user.id);
    activeTenantId = tenantId;
    const memberships = await tenantsForUser(prisma, user.id, user.role);
    membershipRole = memberships.find((tenant) => tenant.id === tenantId)?.role ?? null;
    workspaces = memberships
      .filter((tenant) => tenant.archivedAt === null)
      .map((tenant) => ({ id: tenant.id, name: tenant.name, slug: tenant.slug }));
  } catch (error) {
    console.error("[layout] workspace context failed", error);
  }
  // For links on pages whose URL names no project yet (#project-urls).
  const defaultProjectSlug = await firstProjectRefFor(user.id).catch(() => null);
  // A missing Notification table must not take down every signed-in page.
  let unreadCount = 0;
  try {
    // Cached per user and expired by every write that changes it (#317), so
    // ordinary navigation doesn't pay for a count query.
    unreadCount = await getUnreadCount(user.id);
  } catch (error) {
    console.error("[layout] notification count failed", error);
  }

  let pendingEscalationsCount = 0;
  let dockAgents: DockAgent[] = [];
  // Members of this workspace, for the Leaderboard link: nobody ranks against no one. Null when it couldn't be read.
  let memberCount: number | null = null;
  // Earn is a place of its own: on an earn page the agents bar shows the Earn workspace's agents, not the
  // ones in the person's other workspaces.
  const dockTenantId = isEarnPath(requestPath) ? ((await earnWorkspace().catch(() => null))?.id ?? null) : tenantId;
  if (tenantId) {
    try {
      pendingEscalationsCount = await countPendingEscalations(user.id, tenantId);
    } catch (error) {
      console.error("[layout] pending escalations count failed", error);
    }
    try {
      memberCount = await prisma.membership.count({ where: { tenantId } });
    } catch (error) {
      console.error("[layout] member count failed", error);
    }
    try {
      const agents = dockTenantId ? await loadOwnAgents({ userId: user.id, tenantId: dockTenantId }) : [];
      // #710: what each agent earned, from the point entries its work wrote.
      const ids = agents.map((agent) => agent.id);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const [earned, activity, pending] = await Promise.all([
        agentEarnings(prisma, dockTenantId ?? tenantId, ids),
        agentActivity(prisma, dockTenantId ?? tenantId, ids, startOfToday),
        prisma.agentRequest.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, doneAt: null }, _count: { _all: true } }),
      ]);
      const pendingBy = new Map(pending.map((row) => [row.agentId, row._count._all]));
      dockAgents = agents.map((agent) => ({ id: agent.id, name: agent.name, username: agent.username, avatar: agent.avatar, status: agent.status, activity: agent.activity, issue: agent.issue, question: agent.question, earnedPoints: earned.get(agent.id) ?? 0, ...(activity.get(agent.id) ?? { bids: 0, comments: 0, pointsToday: 0 }), pendingRequests: pendingBy.get(agent.id) ?? 0 }));
    } catch (error) {
      console.error("[layout] agents failed", error);
    }
  }

  // Earn (#earn-drafts): the balance and Withdraw are for the earn pages only. Everywhere else, Ideas included,
  // the app looks as it always does, even for someone who is in the Earn workspace.
  const earnSample = isEarnPath(requestPath) ? await earnBalanceFor(user.id) : null;
  // On the earn pages the agent bar shows what they have earned, the same amount as the header.
  if (earnSample) dockAgents = dockAgents.map((agent) => ({ ...agent, earnedPoints: earnSample.earned }));

  // #287: one primary-key read; a failure leaves shortcuts on, the default.
  let shortcutsEnabled = true;
  try {
    const prefs = await prisma.user.findUnique({
      where: { id: user.id },
      select: { keyboardShortcuts: true },
    });
    shortcutsEnabled = prefs?.keyboardShortcuts ?? true;
  } catch (error) {
    console.error("[layout] shortcut setting failed", error);
  }

  return (
    // data-app-shell switches the page (and its dialogs and toasts) to Inter; see globals.css.
    <div data-app-shell="" className="flex min-h-screen flex-col bg-zk-bg">
      <SkipLink />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          userName={user.name ?? user.email}
          userImage={user.image}
          role={user.role}
          isRealSuperAdmin={user.isRealSuperAdmin}
          isRealAdmin={user.isRealAdmin}
          unreadCount={unreadCount}
          pendingEscalationsCount={pendingEscalationsCount}
          userId={user.id}
          workspaces={workspaces}
          activeTenantId={activeTenantId}
          defaultProjectSlug={defaultProjectSlug}
          reportFormUrl={REPORT_FORM_URL}
          organizationAdmin={tenantId !== null && isOrganizationAdmin(membershipRole, user.role)}
          earned={earnSample ? earnSample.earned : null}
          withdraw={earnSample ? withdrawInfo(earnSample.stage, earnSample.earned) : null}
          version={appVersionLabel()}
          memberCount={memberCount}
          agentCount={dockAgents.length}
        />
        <main
          id={MAIN_CONTENT_ID}
          /* Focusable so the skip link and the route announcer can move focus
             here; -1 keeps it out of the normal tab order. */
          tabIndex={-1}
          // Below lg the bottom nav strip covers the last ~4.5rem of the screen.
          className={`${PAGE_CONTAINER_CLASS} min-w-0 flex-1 overflow-x-clip py-6 outline-none max-lg:pb-28 max-sm:px-2 max-sm:pt-2.5 sm:px-6 sm:py-8 max-lg:sm:pb-28`}
        >
          {children}
        </main>
      </div>
      {/* The agents dock keeps the page's foot clear of its floor line itself, as tall as what stands on it, and draws nothing (no spacer either) where it doesn't help. */}
      <AgentsDock agents={dockAgents} defaultProjectSlug={defaultProjectSlug} version={appVersionLabel()} earn={earnSample !== null} memberCount={memberCount} />
      <FocusMainOnNavigate />
      {welcomeNotice ? <EarnWelcomeToast /> : null}
      <KeyboardShortcuts
        enabled={shortcutsEnabled}
      />
    </div>
  );
}
