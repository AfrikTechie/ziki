import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor, notificationInOrganisation } from "@/lib/organisation-context";
import { countPendingEscalations } from "@/lib/agent-questions";
import { parseInboxTrack } from "@/lib/my-work-filter";
import { countOpenRequestsForUser } from "@/lib/support-threads";
import { NotificationsView } from "./notifications-view";
import { EscalationsView } from "./escalations-view";
import { MessagesView } from "./messages-view";
import { RequestsView } from "./requests-view";

export const metadata = { title: "Inbox" };

type Params = { tab?: string; scope?: string | string[]; page?: string | string[]; status?: string; track?: string | string[]; agent?: string; thread?: string };

const TRACK_OPTIONS = [
  { value: "all", label: "All work" },
  { value: "product", label: "Product" },
  { value: "marketing", label: "Marketing" },
] as const;

/**
 * The Inbox (#inbox): your notifications, the escalations where agents stop
 * for you, and your messages with your agents (the one place you write to them). The envelope in the top bar opens it; its count is both.
 */
export default async function InboxPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const user = await requireUser();
  const params = (await searchParams) ?? {};
  const tab = params.tab === "escalations" ? "escalations" : params.tab === "messages" ? "messages" : params.tab === "requests" ? "requests" : "notifications";
  const organisationId = await currentOrganisationIdFor(user.id);
  const [unread, waiting, openRequestsCount] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null, ...notificationInOrganisation(organisationId, false) } }),
    organisationId ? countPendingEscalations(user.id, organisationId).catch(() => 0) : Promise.resolve(0),
    organisationId ? countOpenRequestsForUser(user.id, organisationId).catch(() => 0) : Promise.resolve(0),
  ]);
  const track = parseInboxTrack(params.track);
  const trackQuery = track === "all" ? "" : `track=${track}`;
  const tabs = [
    { value: "notifications", label: "Notifications", href: trackQuery ? `/inbox?${trackQuery}` : "/inbox", count: unread },
    { value: "escalations", label: "Escalations", href: `/inbox?tab=escalations${trackQuery ? `&${trackQuery}` : ""}`, count: waiting },
    { value: "messages", label: "Messages", href: "/inbox?tab=messages", count: 0 },
    { value: "requests", label: "Requests", href: "/inbox?tab=requests", count: openRequestsCount },
  ] as const;
  // Changing the track keeps the tab and its own filter, and goes back to the first page.
  const trackHref = (value: (typeof TRACK_OPTIONS)[number]["value"]) => {
    const next = new URLSearchParams();
    if (tab === "escalations") next.set("tab", tab);
    if (tab === "escalations" && params.status) next.set("status", params.status);
    if (tab === "notifications" && params.scope === "all") next.set("scope", "all");
    if (value !== "all") next.set("track", value);
    const query = next.toString();
    return query ? `/inbox?${query}` : "/inbox";
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-10">
      <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-zk-text">Inbox</h1>
      <nav aria-label="Inbox" className="flex gap-1 border-b border-zk-border">
        {tabs.map((item) => {
          const on = item.value === tab;
          return (
            <Link
              key={item.value}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${
                on ? "border-electric-blue-strong text-zk-text" : "border-transparent text-zk-muted hover:text-zk-text"
              }`}
            >
              {item.label}
              {item.count > 0 ? (
                <span className="rounded-full bg-electric-blue-strong px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white">{item.count}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <nav aria-label="Filter by work" className="flex flex-wrap items-center gap-1.5">
        {TRACK_OPTIONS.map(({ value, label }) => {
          const on = track === value;
          return (
            <Link
              key={value}
              href={trackHref(value)}
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium ${
                on ? "border-electric-blue-strong bg-electric-blue-strong text-white" : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-tint"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {tab === "messages" ? (
        <MessagesView agent={params.agent} />
      ) : tab === "escalations" ? (
        <EscalationsView searchParams={Promise.resolve({ status: params.status, track })} />
      ) : tab === "requests" ? (
        <RequestsView thread={params.thread} />
      ) : (
        <NotificationsView searchParams={Promise.resolve({ scope: params.scope, page: params.page, track })} />
      )}
    </div>
  );
}
