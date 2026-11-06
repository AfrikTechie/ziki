import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatZ } from "@/lib/points/rules";
import { EARN_TASKS, EARN_WORK, zikiTaskPath } from "@/lib/earn/draft";
import { taskStateFor, type EarnTaskState } from "@/lib/earn/progress";
import { earnState, requireEarnAgent, startTaskIfAgentConnected } from "@/lib/earn/state";
import { startEarnTaskAction } from "@/app/(app)/earn/actions";
import { EarnSubmitForm } from "@/components/earn-submit-form";
import { EarnPromptBox } from "@/components/earn-prompt-box";
import { EARN_TASK_CHECKS, EARN_TASK_UI } from "@/lib/earn/task-ui";
import { agentsLink, agentsPrimaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";
import { earnAgentWhere } from "@/lib/earn/earner";

export const metadata = { title: "Marketing task" };

/** What happens to a task, in plain words, for the side panel. */
const BEATS = [
  { key: "in-progress", label: "You and your agent do it", note: "Now" },
  { key: "in-review", label: "Ziki checks it", note: "Usually within a day" },
  { key: "paid", label: "You get paid", note: "Straight to your balance" },
] as const;

const WORD: Record<EarnTaskState, string> = { paid: "Paid", "in-review": "Checking", "in-progress": "In progress", open: "" };
const DOT: Record<EarnTaskState, string> = { paid: "bg-zk-ok-fg", "in-review": "bg-zk-warn-fg", "in-progress": "bg-electric-blue-strong", open: "bg-zk-seg" };

/**
 * One marketing task (#earn-tasks): the earner's own page for doing it, at /earn/marketing/<n>. A header with
 * what it pays, then the work in three steps (tell your agent, your part, show us), with a side panel that says
 * what happens next and lists the other tasks. The four tasks are independent, so every one is open.
 */
export default async function EarnTaskPage({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const { n: raw } = await params;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > EARN_TASKS.length) notFound();
  const user = await requireUser();
  await requireEarnAgent(user.id);
  await startTaskIfAgentConnected(user.id, n);
  const { rows } = await earnState(user.id);
  const index = n - 1;
  const task = EARN_TASKS[index];
  const work = EARN_WORK[task.id];
  const ui = EARN_TASK_UI[task.id];
  const state: EarnTaskState = taskStateFor(rows, index);
  const row = await prisma.earnTaskProgress.findUnique({
    where: { userId_taskKey: { userId: user.id, taskKey: task.id } },
    select: { status: true, proof: true, note: true },
  });
  const agent = await prisma.agent.findFirst({ where: earnAgentWhere(user.id), orderBy: { createdAt: "asc" }, select: { id: true, name: true, avatar: true } }).catch(() => null);
  const agentName = agent?.name ?? "Your agent";
  const initials = agentName.slice(0, 2);
  // After this one, the next task still to do (any order), looking on from this one and then back round.
  const nextIndex = [...EARN_TASKS.keys()].map((_, step) => (index + 1 + step) % EARN_TASKS.length).find((i) => i !== index && taskStateFor(rows, i) !== "paid");
  const next = nextIndex === undefined ? null : EARN_TASKS[nextIndex];
  const beat = state === "in-review" ? 1 : state === "paid" ? 2 : 0;
  const sentBack = row?.status === "rejected";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <Link href="/earn/marketing" className={`self-start text-sm ${agentsLink}`}>← Marketing</Link>

      <header className={`${agentsSurface} earn-rise relative flex flex-wrap items-center gap-5 overflow-hidden p-5 sm:p-7`}>
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-zk-tint/60" />
        <span aria-hidden="true" className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] ${ui.tint}`}>
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ui.icon} /></svg>
        </span>
        <div className="relative min-w-0 flex-1 basis-64 space-y-1">
          <p className="text-xs font-semibold text-zk-muted">Marketing · Task {n} of {EARN_TASKS.length}</p>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zk-text sm:text-4xl">{task.title}</h1>
          <p className="text-sm text-zk-text2">{task.detail}</p>
        </div>
        <div className="relative text-right">
          <p className="text-3xl font-extrabold tabular-nums text-zk-ok-fg">+{formatZ(task.pay)}</p>
          <p className="text-xs text-zk-muted">{state === "paid" ? "Paid to your balance" : "Paid once Ziki checks it"}</p>
        </div>
      </header>


      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {sentBack && row?.note ? (
            <p className="earn-rise rounded-2xl bg-zk-warn-bg px-4 py-3 text-sm text-zk-warn-fg" role="status">
              <span className="font-bold">Sent back:</span> {row.note}
            </p>
          ) : null}

          {state === "open" ? (
            <section className={`${agentsSurface} earn-rise space-y-3 p-5 sm:p-6`}>
              <h2 className="text-lg font-extrabold text-zk-text">Ready when you are</h2>
              <p className="text-sm text-zk-text2">{agentName} is connected, so this starts on its own. Press Start if it hasn’t.</p>
              <form action={startEarnTaskAction}>
                <input type="hidden" name="n" value={n} />
                <button type="submit" className={agentsPrimaryBtn}>Start this task</button>
              </form>
            </section>
          ) : null}

          {state === "in-progress" ? (
            <ol className="m-0 flex list-none flex-col gap-4 p-0">
              <li className={`${agentsSurface} earn-rise p-5 sm:p-6`} style={{ ["--i" as string]: 1 }}>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zk-tint text-sm font-extrabold text-zk-info-fg">{initials}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-extrabold tracking-tight text-zk-text">Step 1 · Tell {agentName}</h2>
                    <p className="text-xs text-zk-muted">Copy this and paste it into {agentName}</p>
                  </div>
                  <span className="rounded-full bg-zk-info-bg px-2.5 py-1 text-xs font-bold text-zk-info-fg">Waiting for you</span>
                </div>
                <EarnPromptBox prompt={ui.prompt} />
              </li>
              <li className={`${agentsSurface} earn-rise p-5 sm:p-6`} style={{ ["--i" as string]: 2 }}>
                <h2 className="text-lg font-extrabold tracking-tight text-zk-text">Step 2 · Your part</h2>
                <p className="mt-1 text-sm text-zk-text2">{work.you}</p>
              </li>
              <li className={`${agentsSurface} earn-rise p-5 sm:p-6`} style={{ ["--i" as string]: 3 }}>
                <h2 className="text-lg font-extrabold tracking-tight text-zk-text">Step 3 · Show us</h2>
                <ul className="m-0 mb-4 mt-2 flex list-none flex-col gap-1.5 p-0 text-sm text-zk-text2">
                  {EARN_TASK_CHECKS[task.id].map((check) => (
                    <li key={check} className="flex items-center gap-2">
                      <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zk-ok-bg text-[10px] font-extrabold text-zk-ok-fg"><svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
                      {check}
                    </li>
                  ))}
                </ul>
                <EarnSubmitForm n={n} label={work.proofLabel} hint={work.proofHint} resend={sentBack} />
              </li>
            </ol>
          ) : null}

          {state === "in-review" ? (
            <section className={`${agentsSurface} earn-rise space-y-2 p-5 sm:p-6`}>
              <h2 className="text-lg font-extrabold text-zk-text">Ziki is checking it</h2>
              <p className="text-sm text-zk-text2">Every task is checked before it pays. You’ll see it here the moment it’s paid.</p>
            </section>
          ) : null}

          {state === "paid" ? (
            <section className={`${agentsSurface} earn-rise space-y-3 p-5 sm:p-6`}>
              <h2 className="text-lg font-extrabold text-zk-text">Paid</h2>
              <p className="text-sm text-zk-text2">+{formatZ(task.pay)} is in your balance.</p>
              {next && nextIndex !== undefined ? (
                <Link href={zikiTaskPath(nextIndex + 1)} className={agentsPrimaryBtn}>Next: {next.title}</Link>
              ) : (
                <Link href="/earn/earnings" className={agentsPrimaryBtn}>All four done. See your earnings</Link>
              )}
            </section>
          ) : null}

          {(state === "in-review" || state === "paid") && row?.proof ? (
            <section aria-labelledby="task-work" className={`${agentsSurface} earn-rise space-y-3 p-5 sm:p-6`}>
              <h2 id="task-work" className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">{work.proofLabel}</h2>
              <p className="whitespace-pre-wrap break-words rounded-2xl bg-zk-chip px-4 py-3 text-sm text-zk-text2">{row.proof}</p>
            </section>
          ) : null}
        </div>

        <aside className={`${agentsSurface} earn-rise space-y-5 p-5 lg:sticky lg:top-24`} style={{ ["--i" as string]: 2 }}>
          <div>
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.07em] text-zk-muted">What happens next</h2>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {BEATS.map((b, i) => {
                const done = i < beat || (i === beat && state === "paid");
                const now = i === beat && !done;
                return (
                  <li key={b.key} className="flex gap-3">
                    <span aria-hidden="true" className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${done ? "bg-zk-ok-fg" : now ? "bg-electric-blue-strong ring-4 ring-electric-blue/15" : "bg-zk-seg"}`} />
                    <span>
                      <span className={`block text-sm ${now ? "font-bold text-zk-text" : done ? "text-zk-text" : "text-zk-text2"}`}>{b.label}{b.key === "paid" ? ` +${formatZ(task.pay)}` : ""}</span>
                      <span className="block text-xs text-zk-muted">{done ? "Done" : b.note}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="border-t border-zk-divider pt-4">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.07em] text-zk-muted">Other tasks</h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {EARN_TASKS.map((other, i) => {
                if (i === index) return null;
                const otherState = taskStateFor(rows, i);
                return (
                  <li key={other.id}>
                    <Link href={zikiTaskPath(i + 1)} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue">
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[otherState]}`} />
                        <span className="truncate text-zk-text">{other.title}</span>
                      </span>
                      <span className="shrink-0 text-xs">
                        <span className="text-zk-muted">{WORD[otherState]}</span> <b className="tabular-nums text-zk-ok-fg">+{formatZ(other.pay)}</b>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
