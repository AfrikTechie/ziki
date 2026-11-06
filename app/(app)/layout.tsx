import { cache } from "react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import { isLinkPreviewBot } from "@/lib/link-preview";
import { isPublicAgentPath } from "@/lib/public-agent-paths";
import { AppHeader } from "@/components/app-header";
import { getUnreadCount } from "@/lib/lookups";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/skip-link";
import { PAGE_CONTAINER_CLASS } from "@/components/page-container";
import { FocusMainOnNavigate } from "@/components/focus-main-on-navigate";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { isOrganisationAdmin, type OrganisationRole } from "@/lib/organisation-role";
import type { OrganisationOption, ExternalProjectChoice } from "@/components/organisation-switcher";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { firstProjectRefFor } from "@/lib/project-route";
import { organisationsForUser } from "@/lib/organisations";
import { countPendingEscalations } from "@/lib/agent-questions";
import { loadOwnAgents } from "@/lib/dashboard-overview";
import { AgentsDock, type DockAgent } from "@/components/agents-dock";
import { appVersionLabel } from "@/lib/deployed-version";
import { agentActivity, agentEarnings } from "@/lib/points/agent-earnings";
import { earnState, showEarnWelcome } from "@/lib/earn/state";
import { EarnPaidCelebration } from "@/components/earn-paid-celebration";
import { EARN_REF_COOKIE, syncReferral } from "@/lib/earn/outreach";
import { EARN_TASKS } from "@/lib/earn/draft";
import { EarnWelcomeToast } from "@/components/earn-welcome-toast";
import { isEarnPath } from "@/lib/earn/paths";
import { withdrawInfo } from "@/lib/earn/draft";
import { earnAgentWhere, earnOrganisation } from "@/lib/earn/earner";

async function getOrganisationProjects(organisationId: string) {
  return prisma.project.findMany({
    where: { organisationId, archivedAt: null },
    select: { id: true, name: true, slug: true, organisationId: true },
    orderBy: { name: "asc" },
  });
}

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
  const reqPath = (await headers()).get("x-ziki-path") ?? "";
  if (!session?.user && (isPublicAgentPath(reqPath) || reqPath === "/discover")) {
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
  // The header lists this person's organisations. Pages still resolve the active
  // project inside the current organisation, so a foreign project id is ignored.
  let organisationOptions: OrganisationOption[] = [];
  let externalProjects: ExternalProjectChoice[] = [];
  let activeOrganisationId: string | null = null;
  let organisationId: string | null = null;
  let membershipRole: OrganisationRole | null = null;
  try {
    organisationId = await currentOrganisationIdFor(user.id);
    activeOrganisationId = organisationId;
    const memberships = await organisationsForUser(prisma, user.id, user.role);
    const activeOrganisations = memberships.filter((organisation) => organisation.archivedAt === null);

    const pathSegments = requestPath.split("/").filter(Boolean);
    const routeOrg = pathSegments[0] ? decodeURIComponent(pathSegments[0]) : null;
    const matchedOrg = routeOrg ? activeOrganisations.find((t) => t.slug === routeOrg) : null;
    if (matchedOrg) {
      organisationId = matchedOrg.id;
      activeOrganisationId = matchedOrg.id;
    }
    membershipRole = memberships.find((organisation) => organisation.id === organisationId)?.role ?? null;

    const [orgProjects, userProjectMemberships] = await Promise.all([
      organisationId ? getOrganisationProjects(organisationId) : Promise.resolve([]),
      prisma.projectMembership.findMany({
        where: {
          userId: user.id,
          project: {
            archivedAt: null,
            organisation: { archivedAt: null },
          },
        },
        select: {
          project: {
            select: {
              id: true,
              name: true,
              slug: true,
              organisationId: true,
              organisation: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      }),
    ]);

    const projectsByOrg = new Map<string, Array<{ id: string; name: string; slug: string }>>();
    const orgProjectIds = new Set<string>();
    for (const p of orgProjects) {
      orgProjectIds.add(p.id);
      const list = projectsByOrg.get(p.organisationId) ?? [];
      list.push({ id: p.id, name: p.name, slug: p.slug });
      projectsByOrg.set(p.organisationId, list);
    }

    organisationOptions = activeOrganisations.map((organisation) => ({
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      projects: projectsByOrg.get(organisation.id) ?? [],
    }));

    externalProjects = userProjectMemberships
      .filter((m) => !orgProjectIds.has(m.project.id))
      .map((m) => ({
        id: m.project.id,
        name: m.project.name,
        slug: m.project.slug,
        organisationId: m.project.organisationId,
        organisationName: m.project.organisation.name,
        organisationSlug: m.project.organisation.slug,
      }));
  } catch (error) {
    console.error("[layout] organisation context failed", error);
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
  // Members of this organisation, for the Leaderboard link: nobody ranks against no one. Null when it couldn't be read.
  let memberCount: number | null = null;
  // Earn is a place of its own: on an earn page the agents bar shows the Earn organisation's agents, not the
  // ones in the person's other organisations.
  const earnOrganisationId = (await earnOrganisation().catch(() => null))?.id ?? null;
  // In the Earn organisation the app is Earn's on every page, not only under /earn: the builders' links stay away
  // even when the person lands on one of the organisation's ordinary pages.
  const inEarnOrganisation = earnOrganisationId !== null && organisationId === earnOrganisationId;
  // A business that opened an earner's link and then made an account (#earn-outreach): trace it back, and tick
  // when it starts its first project. Only while the link's 30-day note is in this browser.
  const earnRef = (await cookies()).get(EARN_REF_COOKIE)?.value ?? null;
  if (earnRef) await syncReferral(prisma, user.id, earnRef, earnOrganisationId).catch((error) => console.error("[layout] earn referral failed", error));
  const earnScoped = isEarnPath(requestPath) || inEarnOrganisation;
  const dockOrganisationId = earnScoped ? earnOrganisationId : organisationId;
  if (organisationId) {
    try {
      pendingEscalationsCount = await countPendingEscalations(user.id, organisationId);
    } catch (error) {
      console.error("[layout] pending escalations count failed", error);
    }
    try {
      memberCount = await prisma.membership.count({ where: { organisationId } });
    } catch (error) {
      console.error("[layout] member count failed", error);
    }
    try {
      const agents = dockOrganisationId ? await loadOwnAgents({ userId: user.id, organisationId: dockOrganisationId }) : [];
      // #710: what each agent earned, from the point entries its work wrote.
      const ids = agents.map((agent) => agent.id);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const [earned, activity, pending] = await Promise.all([
        agentEarnings(prisma, dockOrganisationId ?? organisationId, ids),
        agentActivity(prisma, dockOrganisationId ?? organisationId, ids, startOfToday),
        prisma.agentRequest.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, doneAt: null }, _count: { _all: true } }),
      ]);
      const pendingBy = new Map(pending.map((row) => [row.agentId, row._count._all]));
      dockAgents = agents.map((agent) => ({ id: agent.id, name: agent.name, username: agent.username, avatar: agent.avatar, status: agent.status, activity: agent.activity, issue: agent.issue, question: agent.question, earnedPoints: earned.get(agent.id) ?? 0, ...(activity.get(agent.id) ?? { bids: 0, comments: 0, pointsToday: 0 }), pendingRequests: pendingBy.get(agent.id) ?? 0 }));
    } catch (error) {
      console.error("[layout] agents failed", error);
    }
  }

  // Earn (#earn-drafts): the balance and Withdraw show on the earn pages and anywhere in the Earn organisation. In
  // the person's other organisations the app looks as it always does.
  const earnFull = earnScoped ? await earnState(user.id) : null;
  const earnSample = earnFull ? earnFull.balance : null;
  // Paid tasks, for the one-time celebration of each (the browser remembers which it has shown).
  const paidTasks = earnFull
    ? EARN_TASKS.filter((task) => earnFull.rows.some((row) => row.taskKey === task.id && row.status === "confirmed")).map((task) => ({ key: task.id, title: task.title, pay: task.pay }))
    : [];
  // The earner's own Earn agent, named in the celebration.
  const earnAgentName = paidTasks.length > 0 ? ((await prisma.agent.findFirst({ where: earnAgentWhere(user.id), orderBy: { createdAt: "asc" }, select: { name: true } }).catch(() => null))?.name ?? "your agent") : "your agent";
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
          organisationOptions={organisationOptions}
          externalProjects={externalProjects}
          activeOrganisationId={activeOrganisationId}
          organisationAdmin={isOrganisationAdmin(membershipRole, user.role)}
          defaultProjectSlug={defaultProjectSlug}
          earned={earnSample ? earnSample.earned : null}
          inEarnOrganisation={inEarnOrganisation}
          withdraw={earnSample ? withdrawInfo(earnSample.stage, earnSample.earned, earnSample.done) : null}
          version={appVersionLabel()}
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
      <AgentsDock agents={dockAgents} defaultProjectSlug={defaultProjectSlug} earn={earnSample !== null} memberCount={memberCount} />
      <FocusMainOnNavigate />
      {welcomeNotice ? <EarnWelcomeToast /> : paidTasks.length > 0 ? <EarnPaidCelebration paid={paidTasks} agentName={earnAgentName} /> : null}
      <KeyboardShortcuts
        enabled={shortcutsEnabled}
      />
    </div>
  );
}
