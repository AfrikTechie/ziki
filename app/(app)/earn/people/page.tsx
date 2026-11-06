import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZ } from "@/lib/points/rules";
import { CONVERSION_BONUS, EARN_POST_OPENS, stagePeople, type Reached } from "@/lib/earn/draft";
import { earnBalanceFor } from "@/lib/earn/state";
import { agentsLink, agentsMutedClass, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { earnAgentWhere } from "@/lib/earn/earner";
import { followUpDraft, isQuiet } from "@/lib/earn/outreach";
import { getSiteUrl } from "@/lib/site-url";
import { EarnCopyButton } from "@/components/earn-outreach";

export const metadata = { title: "People you reached" };

const dayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const STEPS = [
  { key: "emailed", label: "Emailed" },
  { key: "opened", label: "Opened your link" },
  { key: "signedUp", label: "Signed up" },
  { key: "started", label: "Started a project" },
] as const;

/** How far someone has got: 1 emailed … 4 started a project. */
function reach(person: Reached) {
  return STEPS.filter((step) => person[step.key]).length;
}

/**
 * People you reached (#earn-drafts): who heard about Ziki from you and how
 * close each is to starting a project, which is what pays the last $11 and
 * opens Withdraw. The person closest to it comes first, with one thing to do.
 */
export default async function EarnPeoplePage() {
  const user = await requireUser();
  const [balance, agent] = await Promise.all([
    earnBalanceFor(user.id),
    prisma.agent.findFirst({ where: earnAgentWhere(user.id), orderBy: { createdAt: "asc" }, select: { name: true } }).catch(() => null),
  ]);
  const agentName = agent?.name ?? "Your agent";
  // The businesses the earner emailed (#earn-outreach), with when each was sent and first opened. Before any,
  // the demo people show in local preview only (stagePeople returns none in production).
  const contacts = await prisma.earnContact.findMany({ where: { userId: user.id, sentAt: { not: null } }, orderBy: { sentAt: "asc" } }).catch(() => []);
  const site = getSiteUrl();
  const real = contacts.map((contact) => ({
    name: contact.name,
    contact: contact.contact ?? "",
    emailed: contact.sentAt ? dayLabel.format(contact.sentAt) : null,
    opened: contact.openedAt ? dayLabel.format(contact.openedAt) : null,
    signedUp: contact.signedUpAt ? dayLabel.format(contact.signedUpAt) : null,
    started: contact.startedAt ? dayLabel.format(contact.startedAt) : null,
    followUp: followUpDraft(contact.name, `${site}/r/${contact.code}`, user.name ?? ""),
    quiet: isQuiet(contact),
  }));
  const people: (Reached & { followUp?: string; quiet?: boolean })[] = (real.length > 0 ? real : stagePeople(balance.stage)).sort((a, b) => reach(b) - reach(a));

  // Nobody reached yet: say what fills this page, and the one step that starts it.
  if (people.length === 0) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Link href="/earn/earnings" className={`text-sm ${agentsLink}`}>← My earnings</Link>
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">People you reached</h1>
          <p className="text-sm text-zk-text2">Everyone you email or reach with your link shows up here, with how far they&apos;ve got.</p>
        </div>
        <section aria-labelledby="none-yet" className="rounded-[20px] border border-dashed border-electric-blue/40 bg-zk-surface p-6 sm:p-8">
          <h2 id="none-yet" className="text-xl font-extrabold tracking-tight text-zk-text">No one yet</h2>
          <p className="mt-1 max-w-xl text-sm text-zk-text2">
            Start with who needs Ziki. {agentName} finds 10 businesses like that, writes to each one, and you send the emails from your own inbox.
            The last {formatZ(CONVERSION_BONUS)} of your first withdrawal comes from open-source tasks.
          </p>
          <ol className="m-0 mt-5 grid list-none gap-3 p-0 sm:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.key} className="flex items-center gap-2 text-sm text-zk-text2">
                <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === STEPS.length - 1 ? "border-2 border-zk-warn-bd bg-zk-warn-bg text-zk-warn-fg" : "bg-zk-chip text-zk-muted"}`}>{i + 1}</span>
                {step.label}
              </li>
            ))}
          </ol>
          <Link href="/earn/marketing/3" className={`${agentsPrimaryBtn} mt-6`}>Start: send 10 emails</Link>
        </section>
      </div>
    );
  }

  const closest = people[0];
  const counts = STEPS.map((step) => people.filter((person) => person[step.key]).length);
  const started = Boolean(closest.started);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/earn/earnings" className={`text-sm ${agentsLink}`}>← My earnings</Link>
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">People you reached</h1>
        <p className="text-sm text-zk-text2">
          {people.length} businesses heard about Ziki from you. When one of them starts a project, you get {formatZ(CONVERSION_BONUS)} and Withdraw opens.
        </p>
      </div>

      {/* The one to watch: the person furthest along, and what would move them. */}
      <section
        aria-labelledby="closest"
        className={`rounded-[20px] border p-5 sm:p-6 ${started ? "border-zk-ok-fg/30 bg-zk-ok-bg/40" : "border-electric-blue/30 bg-zk-surface shadow-[0_8px_24px_rgba(46,111,239,0.08)]"}`}
      >
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${started ? "bg-zk-ok-bg text-zk-ok-fg" : "bg-zk-tint text-zk-accent"}`}>
          {started ? `+${formatZ(CONVERSION_BONUS)} on its way` : `Closest to your ${formatZ(CONVERSION_BONUS)}`}
        </span>
        <h2 id="closest" className="mt-3 text-2xl font-extrabold tracking-tight text-zk-text">{closest.name}</h2>
        <p className="text-sm text-zk-muted">{closest.contact}</p>

        <ol className="m-0 mt-5 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4 sm:gap-0">
          {STEPS.map((step, i) => {
            const date = closest[step.key];
            const next = !date && i === reach(closest);
            return (
              <li key={step.key} className="sm:pr-3">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      date ? "bg-zk-ok-fg text-white" : next ? "border-2 border-zk-warn-bd bg-zk-warn-bg text-zk-warn-fg" : "bg-zk-chip text-zk-muted"
                    }`}
                  >
                    {date ? "✓" : i + 1}
                  </span>
                  {i < STEPS.length - 1 ? <span aria-hidden="true" className={`hidden h-0.5 flex-1 rounded-full sm:block ${date ? "bg-zk-ok-fg" : "bg-zk-border"}`} /> : null}
                </div>
                <p className={`mt-2 text-sm font-semibold ${date || next ? "text-zk-text" : "text-zk-muted"}`}>{step.label}</p>
                <p className={`text-xs ${next ? "font-bold text-zk-warn-fg" : "text-zk-muted"}`}>
                  {date ?? (next ? `Pays you +${formatZ(CONVERSION_BONUS)}` : "Not yet")}
                </p>
              </li>
            );
          })}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-zk-border pt-4">
          <p className="min-w-60 flex-1 text-sm text-zk-text2">
            {started
              ? `${closest.name} started a project. Ziki will check it and add your ${formatZ(CONVERSION_BONUS)}.`
              : closest.signedUp
                ? `They signed up on ${closest.signedUp} but haven't started a project yet. A short, friendly follow-up from you is often all it takes.`
                : closest.opened
                  ? `They opened your link on ${closest.opened}. A short, friendly follow-up from you is often all it takes.`
                  : `You emailed them on ${closest.emailed}. Nobody has opened the link yet: give it a few days, then follow up.`}
          </p>
          {started ? (
            <Link href="/earn/earnings" className={agentsPrimaryBtn}>See your earnings</Link>
          ) : (
            <>
              <Link href="/earn/marketing/3" className={agentsSecondaryBtn}>See your emails</Link>
              {closest.followUp ? <EarnCopyButton text={closest.followUp} label="Copy a follow-up" primary /> : null}
            </>
          )}
        </div>
      </section>

      {/* Everyone at once: how many got to each step. */}
      <section aria-labelledby="funnel" className={`${agentsSurface} p-4 sm:p-5`}>
        <h2 id="funnel" className="sr-only">How far everyone got</h2>
        <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {STEPS.map((step, i) => {
            const last = i === STEPS.length - 1;
            return (
              <div key={step.key} className={i > 0 ? "sm:border-l sm:border-zk-border sm:pl-4" : ""}>
                <dt className="text-xs font-semibold text-zk-muted">{step.label}</dt>
                <dd className={`m-0 mt-1 text-3xl font-extrabold tabular-nums ${last ? (counts[i] ? "text-zk-ok-fg" : "text-zk-warn-fg") : "text-zk-text"}`}>
                  {counts[i]}
                  {step.key === "opened" && EARN_POST_OPENS > 0 && real.length === 0 ? <span className="ml-1.5 text-xs font-semibold text-zk-muted">+{EARN_POST_OPENS} from your post</span> : null}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section aria-labelledby="everyone" className="overflow-hidden rounded-[20px] border border-zk-border bg-zk-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zk-border bg-zk-tint px-4 py-3 sm:px-6">
          <h2 id="everyone" className="text-base font-semibold text-zk-text">Everyone you reached</h2>
          <span className="text-xs font-semibold text-zk-muted">Furthest along first</span>
        </div>
        <ul className="m-0 list-none divide-y divide-zk-border p-0">
          {people.map((person) => {
            const r = reach(person);
            const stage = STEPS[r - 1];
            return (
              <li key={person.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_7.5rem] sm:px-6">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zk-text">{person.name}</p>
                  <p className="truncate text-xs text-zk-muted">{person.contact}</p>
                </div>
                <div aria-label={`${r} of ${STEPS.length} steps`} role="img" className="order-3 col-span-2 grid grid-cols-4 gap-1 sm:order-none sm:col-span-1">
                  {STEPS.map((step, i) => (
                    <span key={step.key} className={`h-1.5 rounded-full ${i < r ? "bg-zk-ok-fg" : i === r && r >= 2 ? "bg-zk-warn-bd" : "bg-zk-seg"}`} />
                  ))}
                </div>
                <p className="hidden text-xs text-zk-text2 sm:block">
                  <span className="font-semibold text-zk-text">{stage.label}</span> · {person[stage.key]}
                </p>
                <span className="flex justify-end">
                  {person.started ? (
                    <span className="inline-flex items-center rounded-full bg-zk-ok-bg px-2.5 py-0.5 text-xs font-bold text-zk-ok-fg">+{formatZ(CONVERSION_BONUS)}</span>
                  ) : person.followUp && (r >= 2 || person.quiet) ? (
                    <EarnCopyButton text={person.followUp} label="Follow up" primary={person.quiet} />
                  ) : (
                    <span className="text-xs text-zk-muted">{r >= 2 ? "Follow up soon" : "Give it a few days"}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-zk-border bg-zk-tint px-5 py-4">
        <p className="min-w-60 flex-1 text-sm text-zk-text2">
          <span className="font-bold text-zk-text">Keep it going.</span> Anyone who has not opened their link after 3 days gets a follow-up you can copy. {agentName} can make it sound like you. You send it from your own email.
        </p>
        <Link href="/earn/marketing/4" className={agentsLink}>Reach more people →</Link>
      </div>
      <p className={agentsMutedClass}>Each business counts once, however many times you reach it.</p>
    </div>
  );
}
