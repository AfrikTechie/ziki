import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZ } from "@/lib/points/rules";
import { CONVERSION_BONUS, EARN_TASKS, EARN_WORK, stageTasks, zikiTaskPath } from "@/lib/earn/draft";
import { earnState, requireEarnAgent, startIfAgentConnected } from "@/lib/earn/state";
import { EarnTopStrip } from "@/components/earn-top-strip";
import { agentsLink, agentsPrimaryBtn, agentsSecondaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { earnAgentWhere } from "@/lib/earn/earner";

export const metadata = { title: "Marketing tasks" };

/**
 * Marketing (#earn-tasks, Mark's call of 5 Nov): the tasks an earner sees after
 * choosing Marketing on /earn, at their own URL. Not the builders' issue list: one task at a time, front and
 * centre, with who does what, and the road to the first withdrawal under it.
 */
export default async function EarnTasksPage() {
  const user = await requireUser();
  // No agent connected, no tasks: back to /earn to connect it first.
  await requireEarnAgent(user.id);
  // With an agent connected, the next task starts on its own, before the state is read.
  await startIfAgentConnected(user.id);
  const { stage, started, balance } = await earnState(user.id);
  const agent = await prisma.agent.findFirst({ where: earnAgentWhere(user.id), orderBy: { createdAt: "asc" }, select: { name: true } }).catch(() => null);
  const tasks = stageTasks(stage);
  const index = tasks.findIndex((task) => !task.done);
  const current = index >= 0 ? tasks[index] : null;
  const ready = balance.withdrawable > 0;
  const agentName = agent?.name ?? "Your agent";
  const inProgress = current !== null && started === index + 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EarnTopStrip balance={balance} />
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Marketing</h1>
        <p className="max-w-2xl text-sm text-zk-text2">Help people find Ziki. One task at a time. Your agent does the work, you check it and send it from your own accounts. Each one that’s checked earns you money.</p>
      </div>

      {/* The road: four tasks, then the person who unlocks the first withdrawal. */}
      <section aria-label="Your road to the first withdrawal" className={`${agentsSurface} p-5 sm:p-6`}>
        <ol className="m-0 grid list-none grid-cols-5 gap-2 p-0">
          {[...tasks.map((task) => ({ key: task.id, label: task.title, pay: task.pay, done: task.done })), { key: "person", label: "Open-source tasks", pay: CONVERSION_BONUS, done: balance.converted }].map((stop, i) => {
            const now = !stop.done && i === (index >= 0 ? index : tasks.length);
            return (
              <li key={stop.key} className="relative flex min-w-0 flex-col items-center gap-2 text-center">
                {i > 0 ? <span aria-hidden="true" className={`absolute right-1/2 top-[18px] -z-0 h-[3px] w-full rounded-full ${stop.done || now ? "bg-zk-ok-fg" : "bg-zk-seg"}`} /> : null}
                <span
                  aria-hidden="true"
                  className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold ${
                    stop.done ? "bg-zk-ok-fg text-white" : now ? "border-[3px] border-zk-accent bg-zk-surface text-zk-accent" : "border-2 border-zk-border bg-zk-surface text-zk-muted"
                  }`}
                >
                  {stop.done ? "✓" : i + 1}
                </span>
                <span className={`line-clamp-2 text-xs leading-tight ${now ? "font-bold text-zk-text" : "text-zk-text2"}`}>{stop.label}</span>
                <span className={`font-mono text-xs font-bold tabular-nums ${stop.done ? "text-zk-ok-fg" : "text-zk-muted"}`}>+{formatZ(stop.pay)}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <div>
        {current ? (
          <section aria-labelledby="now-heading" className={`${agentsSurface} space-y-5 p-5 sm:p-7`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="rounded-full bg-zk-info-bg px-2.5 py-1 text-xs font-bold text-zk-info-fg">{inProgress ? "In progress" : `Task ${index + 1} of ${EARN_TASKS.length}`}</span>
              <span className="rounded-[10px] bg-zk-ok-bg px-3 py-1 text-base font-extrabold tabular-nums text-zk-ok-fg">+{formatZ(current.pay)}</span>
            </div>
            <div className="space-y-1.5">
              <h2 id="now-heading" className="text-2xl font-extrabold leading-tight tracking-tight text-zk-text">{current.title}</h2>
              <p className="text-sm text-zk-text2">{current.detail}</p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-zk-tint/70 p-4">
                <dt className="text-xs font-bold text-zk-muted">{agentName} does</dt>
                <dd className="mt-1 text-sm leading-relaxed text-zk-text">{EARN_WORK[current.id].agent}</dd>
              </div>
              <div className="rounded-2xl bg-zk-chip p-4">
                <dt className="text-xs font-bold text-zk-muted">You do</dt>
                <dd className="mt-1 text-sm leading-relaxed text-zk-text">{EARN_WORK[current.id].you}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={zikiTaskPath(index + 1)} className={agentsPrimaryBtn}>
                {inProgress ? "Continue" : "Open the task"}
              </Link>
              <span className="text-xs text-zk-muted">{inProgress ? `${agentName} is on it.` : "Not started yet."}</span>
            </div>
          </section>
        ) : (
          <section aria-labelledby="now-heading" className={`${agentsSurface} space-y-4 p-5 sm:p-7`}>
            <h2 id="now-heading" className="text-2xl font-extrabold leading-tight tracking-tight text-zk-text">
              {ready ? "All done. Withdraw is open." : "All four tasks are done."}
            </h2>
            <p className="max-w-lg text-sm leading-relaxed text-zk-text2">
              {ready
                ? `Your ${formatZ(balance.earned)} is yours to withdraw.`
                : `Marketing alone won’t reach $30. The last ${formatZ(CONVERSION_BONUS)} comes from Open source.`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={ready ? "/earn/withdraw" : "/earn/people"} className={agentsPrimaryBtn}>{ready ? "Withdraw" : "See the people you reached"}</Link>
              <Link href="/earn/earnings" className={agentsSecondaryBtn}>My earnings</Link>
            </div>
          </section>
        )}

      </div>
      <p className="px-1 text-xs leading-relaxed text-zk-muted">
        Not for you? <Link href="/earn/open-source" className={agentsLink}>Try open source</Link> instead.
      </p>
    </div>
  );
}
