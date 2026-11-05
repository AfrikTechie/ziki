import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZ } from "@/lib/points/rules";
import { EARN_TASKS, EARN_WORK, WITHDRAW_THRESHOLD, zikiTaskPath } from "@/lib/earn/draft";
import { paidCount, taskStateFor, type EarnTaskState } from "@/lib/earn/progress";
import { earnState, requireEarnAgent, startIfAgentConnected } from "@/lib/earn/state";
import { startEarnTaskAction } from "@/app/(app)/earn/actions";
import { EarnSubmitForm } from "@/components/earn-submit-form";
import { EarnCelebrate } from "@/components/earn-celebrate";
import { EarnPromptBox } from "@/components/earn-prompt-box";
import { EARN_TASK_UI } from "@/lib/earn/task-ui";
import { agentsLink, agentsPrimaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { earnAgentWhere } from "@/lib/earn/earner";

export const metadata = { title: "Marketing task" };

/** The three beats of a task, in plain words (not the builders' Open, In progress, In review, Paid). */
const BEATS = [
  { key: "in-progress", label: "You and your agent do it" },
  { key: "in-review", label: "Ziki checks it" },
  { key: "paid", label: "You get paid" },
] as const;

/**
 * One marketing task (#earn-tasks): the earner's own page for doing it, at
 * /earn/marketing/<n>. Not an issue page: no number, summary, stage tracker,
 * reporter or assignee. It says what you do, what your agent does, and what
 * happens next. Where it is comes from the earner's task row: started when
 * their agent is connected (or when they press Start), in review once they
 * send it in, paid once Ziki confirms it.
 */
export default async function EarnTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ n: string }>;
  searchParams: Promise<{ celebrate?: string }>;
}) {
  const { n: raw } = await params;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > EARN_TASKS.length) notFound();
  const user = await requireUser();
  const query = await searchParams;
  await requireEarnAgent(user.id);
  await startIfAgentConnected(user.id);
  const { rows, balance } = await earnState(user.id);
  const index = n - 1;
  const task = EARN_TASKS[index];
  const work = EARN_WORK[task.id];
  const ui = EARN_TASK_UI[task.id];
  const state: EarnTaskState = taskStateFor(rows, index);
  const paid = paidCount(rows);
  const row = await prisma.earnTaskProgress.findUnique({
    where: { userId_taskKey: { userId: user.id, taskKey: task.id } },
    select: { status: true, proof: true, note: true },
  });
  const agent = await prisma.agent.findFirst({ where: earnAgentWhere(user.id), orderBy: { createdAt: "asc" }, select: { id: true, name: true, avatar: true } }).catch(() => null);
  const agentName = agent?.name ?? "Your agent";
  const next = EARN_TASKS[index + 1];
  const beat = state === "in-progress" ? 0 : state === "in-review" ? 1 : state === "paid" ? 2 : -1;
  const celebrate = state === "paid" && query.celebrate === "1" && index === paid - 1;
  const sentBack = row?.status === "rejected";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/earn/marketing" className={`self-start text-sm ${agentsLink}`}>← Back</Link>

      <div className="flex flex-wrap items-start gap-4">
        <span aria-hidden="true" className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${ui.tint}`}>
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ui.icon} /></svg>
        </span>
        <div className="min-w-0 flex-1 basis-56 space-y-1">
          <span className="text-xs font-bold text-zk-muted">Task {n} of {EARN_TASKS.length}</span>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zk-text">{task.title}</h1>
          <p className="text-sm text-zk-text2">{task.detail}</p>
        </div>
        <span className="rounded-[10px] bg-zk-ok-bg px-3.5 py-1.5 text-lg font-extrabold tabular-nums text-zk-ok-fg">+{formatZ(task.pay)}</span>
      </div>

      {celebrate ? <EarnCelebrate agent={agent} taskNumber={n} pay={task.pay} from={balance.earned - task.pay} to={balance.earned} total={WITHDRAW_THRESHOLD} /> : null}

      <div className="flex min-w-0 flex-col gap-5">
        {/* Three plain beats, only once the task is under way. */}
        {beat >= 0 ? (
          <ol aria-label="Where this task is" className="m-0 grid list-none grid-cols-3 gap-2 p-0">
            {BEATS.map((b, i) => (
              <li key={b.key} className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-bold ${i < beat || (i === beat && state === "paid") ? "bg-zk-ok-bg text-zk-ok-fg" : i === beat ? "bg-zk-info-bg text-zk-info-fg" : "bg-zk-chip text-zk-muted"}`}>
                <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${i < beat || (i === beat && state === "paid") ? "bg-zk-ok-fg text-white" : i === beat ? "bg-electric-blue-strong text-white" : "bg-zk-surface text-zk-muted"}`}>
                  {i < beat || (i === beat && state === "paid") ? "✓" : i + 1}
                </span>
                {b.label}
              </li>
            ))}
          </ol>
        ) : null}

        {state === "locked" ? (
          <section className={`${agentsSurface} space-y-2 p-5 sm:p-6`}>
            <h2 className="text-lg font-extrabold text-zk-text">Opens after task {n - 1}</h2>
            <p className="text-sm text-zk-text2">Tasks go one at a time, and each builds on the one before.</p>
            <Link href={zikiTaskPath(n - 1)} className={`text-sm ${agentsLink}`}>Go to task {n - 1}: {EARN_TASKS[n - 2].title} →</Link>
          </section>
        ) : state === "open" ? (
          <section className={`${agentsSurface} space-y-3 p-5 sm:p-6`}>
            <h2 className="text-lg font-extrabold text-zk-text">Ready when you are</h2>
            {agent ? (
              <p className="text-sm text-zk-text2">{agentName} is connected, so this starts on its own. Press Start if it hasn’t.</p>
            ) : (
              <p className="text-sm text-zk-text2">Connect your agent and it gets going on its own. Or start it yourself and do it by hand.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <form action={startEarnTaskAction}>
                <button type="submit" className={agentsPrimaryBtn}>Start this task</button>
              </form>
              {agent ? null : <Link href="/earn/agent" className={`text-sm ${agentsLink}`}>Connect my agent</Link>}
            </div>
          </section>
        ) : state === "in-review" ? (
          <section className={`${agentsSurface} space-y-2 p-5 sm:p-6`}>
            <h2 className="text-lg font-extrabold text-zk-text">Ziki is checking it</h2>
            <p className="text-sm text-zk-text2">Every task is checked before it pays. You’ll see it here the moment it’s paid.</p>
          </section>
        ) : state === "paid" ? (
          <section className={`${agentsSurface} space-y-3 p-5 sm:p-6`}>
            <h2 className="text-lg font-extrabold text-zk-text">Paid</h2>
            <p className="text-sm text-zk-text2">+{formatZ(task.pay)} is in your balance.</p>
            {next ? (
              <Link href={zikiTaskPath(n + 1)} className={agentsPrimaryBtn}>Next: {next.title}</Link>
            ) : (
              <Link href="/earn/earnings" className={agentsPrimaryBtn}>All four done. See your earnings</Link>
            )}
          </section>
        ) : null}

        {state === "in-progress" ? (
          <ol className="m-0 grid list-none gap-4 p-0">
            {sentBack && row?.note ? (
              <li className="rounded-2xl bg-zk-warn-bg px-4 py-3 text-sm text-zk-warn-fg" role="status">
                <span className="font-bold">Sent back:</span> {row.note}
              </li>
            ) : null}
            {[
              { n: 1, title: `Tell ${agentName}`, body: <EarnPromptBox prompt={ui.prompt} /> },
              { n: 2, title: "You", body: <p className="text-sm text-zk-text2">{work.you}</p> },
              { n: 3, title: "Show us", body: <EarnSubmitForm n={n} label={work.proofLabel} hint={work.proofHint} resend={sentBack} /> },
            ].map((step) => (
              <li key={step.n} className={`${agentsSurface} p-5 sm:p-6`}>
                <div className="mb-3 flex items-center gap-3">
                  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zk-tint text-sm font-extrabold text-zk-info-fg">{step.n}</span>
                  <h2 className="text-lg font-extrabold tracking-tight text-zk-text">{step.title}</h2>
                </div>
                {step.body}
              </li>
            ))}
          </ol>
        ) : (state === "in-review" || state === "paid") && row?.proof ? (
          <section aria-labelledby="task-work" className={`${agentsSurface} space-y-3 p-5 sm:p-6`}>
            <h2 id="task-work" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">{work.proofLabel}</h2>
            <p className="whitespace-pre-wrap break-words rounded-2xl bg-zk-chip px-4 py-3 text-sm text-zk-text2">{row.proof}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
