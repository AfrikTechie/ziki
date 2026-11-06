"use client";

import { useActionState, useId, useState } from "react";
import { approvePlanAction, sendBackPlanAction, type PlanReviewResult } from "@/app/actions/plan-review";
import { LocalTime } from "@/components/local-time";
import { StepTitle } from "@/components/issue-timeline";
import { EntryReplies, type EntryReplyView } from "@/components/entry-replies";
import { EntryReplyForm } from "@/components/entry-reply-form";
import { EntrySummary } from "@/components/entry-summary";

/** A plan as the issue page shows it (#plan-review): the Plan review step's entry. */
export type PlanStepView = { id: string; text: string; by: "agent" | "owner" };
export type PlanCardView = {
  id: string;
  agentName: string;
  ownerName: string;
  summary: string;
  description: string;
  reading: string;
  assumptions: string;
  uncertainties: string;
  steps: PlanStepView[];
  estimateMinutes: number;
  risk: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  round: number;
  sendBacksLeft: number;
  submittedAt: Date | string;
  decision: "approved" | "sent_back" | null;
  decidedAt: Date | string | null;
  decisionNote: string | null;
  reviewBy: Date | string;
  /** The version the owner decides on: a plan the agent replaced since is refused. */
  updatedAt: Date | string;
  replies: EntryReplyView[];
};

const SCALE: Record<"low" | "medium" | "high", string> = { low: "Low", medium: "Medium", high: "High" };

export function estimateLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 24) return `${hours} h`;
  return `${Math.round((hours / 24) * 10) / 10} d`;
}

/** "Does on its own" and "Needs you": the authority split, a product rule, not something the owner edits (#plan-review rule 11). */
function AuthoritySplit({ agentName }: { agentName: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-zk-divider px-3 py-2.5">
        <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">{agentName} does on its own</p>
        <p className="m-0 mt-1 text-[13px] text-zk-text2">Investigate, run tests, post progress updates.</p>
      </div>
      <div className="rounded-xl border border-zk-warn-bd bg-zk-warn-bg/40 px-3 py-2.5">
        <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-zk-warn-fg">Needs you</p>
        <p className="m-0 mt-1 text-[13px] text-zk-text2">Approving the plan, any scope change, opening a pull request, merging.</p>
      </div>
    </div>
  );
}

function Reading({ plan }: { plan: PlanCardView }) {
  return (
    <dl className="m-0 grid gap-2 text-[13px] sm:grid-cols-[120px_1fr]">
      <dt className="font-semibold text-zk-text">Its reading</dt>
      <dd className="m-0 text-zk-text2">{plan.reading}</dd>
      <dt className="font-semibold text-zk-text">Assumptions</dt>
      <dd className="m-0 text-zk-text2">{plan.assumptions}</dd>
      <dt className="font-semibold text-zk-text">Not sure</dt>
      <dd className="m-0 text-zk-text2">{plan.uncertainties}</dd>
    </dl>
  );
}

function StepList({ steps }: { steps: PlanStepView[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {steps.map((step, index) => (
        <li key={step.id} className="flex items-start gap-2.5 text-[13px]">
          <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zk-chip font-mono text-[11px] font-semibold text-zk-text2">{index + 1}</span>
          <span className="min-w-0 flex-1 text-zk-text">{step.text}</span>
          {step.by === "owner" ? <span className="shrink-0 rounded-full bg-zk-warn-bg px-2 py-0.5 text-[11px] font-semibold text-zk-warn-fg">owner</span> : null}
        </li>
      ))}
    </ol>
  );
}

const buttonBase = "inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-accent disabled:opacity-50";
const inputClass = "w-full rounded-lg border border-zk-border bg-zk-surface px-2.5 py-1.5 text-[13px] text-zk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-accent";

/**
 * The owner's view while the plan waits on them: every step editable,
 * deletable, with "Insert step here" between, then Approve or Send back
 * (with a note). Edited, inserted and reordered steps are attributed to the
 * owner on the server.
 */
function OwnerReview({ bugId, plan }: { bugId: string; plan: PlanCardView }) {
  const formId = useId();
  const [steps, setSteps] = useState<{ id?: string; text: string; key: string }[]>(() => plan.steps.map((step) => ({ id: step.id, text: step.text, key: step.id })));
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");
  const [approveResult, approve, approving] = useActionState<PlanReviewResult | undefined, FormData>(approvePlanAction, undefined);
  const [sendBackResult, sendBack, sending] = useActionState<PlanReviewResult | undefined, FormData>(sendBackPlanAction, undefined);
  const edited = steps.length !== plan.steps.length || steps.some((step, index) => step.id !== plan.steps[index]?.id || step.text !== plan.steps[index]?.text);
  const update = (key: string, text: string) => setSteps((list) => list.map((step) => (step.key === key ? { ...step, text } : step)));
  const remove = (key: string) => setSteps((list) => (list.length > 1 ? list.filter((step) => step.key !== key) : list));
  const insertAt = (index: number) => setSteps((list) => [...list.slice(0, index), { text: "", key: `new-${Date.now()}-${index}` }, ...list.slice(index)]);
  const error = (approveResult && !approveResult.ok && approveResult.error) || (sendBackResult && !sendBackResult.ok && sendBackResult.error) || null;
  const canSendBack = plan.sendBacksLeft > 0;
  const version = new Date(plan.updatedAt).toISOString();

  // The final round: the plan was sent back twice already, so the steps can't change again; approve it or let the window run out.
  if (!canSendBack) {
    return (
      <div className="flex flex-col gap-3">
        <StepList steps={plan.steps} />
        <p className="m-0 text-xs text-zk-muted">This plan was sent back twice already: approve it as it is, or let the window run out.</p>
        <form action={approve}>
          <input type="hidden" name="bugId" value={bugId} />
          <input type="hidden" name="planVersion" value={version} />
          <button type="submit" disabled={approving} className={`${buttonBase} bg-electric-blue-strong text-white hover:opacity-90`} data-testid="approve-plan">
            {approving ? "Approving…" : "Approve"}
          </button>
        </form>
        {error ? <p className="m-0 text-xs text-zk-bad-fg" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="The plan's steps, editable">
        {steps.map((step, index) => (
          <li key={step.key} className="flex flex-col gap-1">
            <button type="button" onClick={() => insertAt(index)} className="self-start text-[11px] font-semibold text-zk-accent hover:underline">
              + Insert step here
            </button>
            <div className="flex items-start gap-2">
              <span className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zk-chip font-mono text-[11px] font-semibold text-zk-text2">{index + 1}</span>
              <input
                aria-label={`Step ${index + 1}`}
                value={step.text}
                onChange={(event) => update(step.key, event.target.value)}
                className={inputClass}
                maxLength={500}
              />
              <button type="button" onClick={() => remove(step.key)} disabled={steps.length === 1} className="mt-1 text-[12px] font-semibold text-zk-muted hover:text-zk-bad-fg disabled:opacity-40" aria-label={`Delete step ${index + 1}`}>
                Delete
              </button>
            </div>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => insertAt(steps.length)} className="text-[11px] font-semibold text-zk-accent hover:underline">
            + Insert step here
          </button>
        </li>
      </ol>
      {edited ? <p className="m-0 text-xs text-zk-warn-fg">You changed the steps: send the plan back so {plan.agentName} can take them up, or they are discarded on approve.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <form action={approve}>
          <input type="hidden" name="bugId" value={bugId} />
          <input type="hidden" name="planVersion" value={version} />
          <button type="submit" disabled={approving || sending} className={`${buttonBase} bg-electric-blue-strong text-white hover:opacity-90`} data-testid="approve-plan">
            {approving ? "Approving…" : "Approve"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setSendingBack((open) => !open)}
          disabled={!canSendBack || approving || sending}
          className={`${buttonBase} border border-zk-border bg-zk-surface text-zk-text hover:bg-zk-chip`}
          aria-expanded={sendingBack}
          aria-controls={`${formId}-sendback`}
          title={canSendBack ? undefined : "This plan was sent back twice already: approve it, or let the window run out."}
        >
          Send back
        </button>
        <span className="text-xs text-zk-muted">{plan.sendBacksLeft} send-back{plan.sendBacksLeft === 1 ? "" : "s"} left</span>
      </div>
      {sendingBack && canSendBack ? (
        <form id={`${formId}-sendback`} action={sendBack} className="flex flex-col gap-2 rounded-xl border border-zk-divider p-3">
          <input type="hidden" name="bugId" value={bugId} />
          <input type="hidden" name="planVersion" value={version} />
          <input type="hidden" name="steps" value={JSON.stringify(steps.map(({ id, text }) => (id ? { id, text } : { text })))} />
          <label htmlFor={`${formId}-note`} className="text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">What should change</label>
          <textarea id={`${formId}-note`} name="note" value={note} onChange={(event) => setNote(event.target.value)} required rows={3} maxLength={2000} className={inputClass} placeholder="Tell the agent what to change and why." />
          <div>
            <button type="submit" disabled={sending || !note.trim()} className={`${buttonBase} bg-zk-warn-fg text-white hover:opacity-90`} data-testid="send-back-plan">
              {sending ? "Sending back…" : "Send the plan back"}
            </button>
          </div>
        </form>
      ) : null}
      {error ? <p className="m-0 text-xs text-zk-bad-fg" role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * The Plan review step's card (#plan-review). While the issue is at
 * In progress · Plan review it is the latest thing on the page: the agent's
 * reading of the task, its plan, and, for the agent's owner, the controls to
 * shape and decide it. Once approved it folds like any past step and stays
 * on the issue as what the delivery is judged against.
 */
export function PlanReviewCard({
  bugId,
  plan,
  isOwner,
  live,
  deadline,
  canReply,
  difficultyLabel,
}: {
  bugId: string;
  plan: PlanCardView | null;
  /** The viewer owns the agent whose plan it is. */
  isOwner: boolean;
  /** The issue is at In progress · Plan review now. */
  live: boolean;
  deadline: Date | string | null;
  canReply: boolean;
  difficultyLabel: string;
}) {
  const waiting = live && plan && plan.decision === null;
  const sentBack = live && plan && plan.decision === "sent_back";
  const approved = plan?.decision === "approved";
  const title = !plan ? "Plan review" : approved ? "Plan approved" : waiting ? "Plan review" : "Plan sent back";
  const summaryLine = plan ? `${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"} · est. ${estimateLabel(plan.estimateMinutes)} · risk ${SCALE[plan.risk].toLowerCase()} · confidence ${SCALE[plan.confidence].toLowerCase()}` : null;

  const body = (
    <div className="flex flex-col gap-3 rounded-xl border border-zk-warn-bd bg-zk-warn-bg/30 px-3.5 py-3" id="plan" data-testid="plan-review-card">
      {plan ? (
        <>
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <b className="font-semibold text-zk-text">{plan.agentName}</b>
            <span className="text-zk-muted">wants to take this · for {plan.ownerName}</span>
            <span className="rounded-full bg-zk-chip px-2 py-0.5 text-[11px] font-semibold text-zk-text2">{difficultyLabel}</span>
            <span className="rounded-full bg-zk-chip px-2 py-0.5 text-[11px] font-semibold text-zk-text2">Round {plan.round}</span>
            <span className="ml-auto text-xs text-zk-muted">
              Estimate {estimateLabel(plan.estimateMinutes)} · Risk {SCALE[plan.risk]} · Confidence {SCALE[plan.confidence]}
            </span>
          </p>
          <EntrySummary summary={plan.summary} description={plan.description} />
          <section aria-label={`How ${plan.agentName} read this task`}>
            <h4 className="m-0 mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">How {plan.agentName} read this task</h4>
            <Reading plan={plan} />
          </section>
          {sentBack && plan.decisionNote ? (
            <p className="m-0 rounded-lg border border-zk-warn-bd bg-zk-surface px-3 py-2 text-[13px] text-zk-text">
              <b className="font-semibold">Sent back by {plan.ownerName}:</b> {plan.decisionNote}
            </p>
          ) : null}
          <section aria-label="The plan">
            <h4 className="m-0 mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zk-muted">The plan</h4>
            {/* Keyed on the version: a plan the agent replaced resets the owner's edits to the new steps. */}
            {waiting && isOwner ? <OwnerReview key={new Date(plan.updatedAt).toISOString()} bugId={bugId} plan={plan} /> : <StepList steps={plan.steps} />}
          </section>
          {live ? <AuthoritySplit agentName={plan.agentName} /> : null}
          <p className="m-0 text-xs text-zk-muted">
            {approved && plan.decidedAt ? (
              <>Approved by {plan.ownerName} <LocalTime date={plan.decidedAt} absolute /></>
            ) : waiting ? (
              <>Submitted <LocalTime date={plan.submittedAt} absolute />{isOwner ? ". Only you can approve it or send it back" : `. Waiting for ${plan.ownerName}`}</>
            ) : sentBack ? (
              <>Sent back <LocalTime date={plan.decidedAt ?? plan.submittedAt} absolute />. Waiting for {plan.agentName} to resubmit or refuse</>
            ) : (
              <>Submitted <LocalTime date={plan.submittedAt} absolute /></>
            )}
            {live && deadline ? <> · window ends <LocalTime date={deadline} /></> : null}
          </p>
          <EntryReplies replies={plan.replies} />
          {canReply ? <EntryReplyForm bugId={bugId} target={{ planId: plan.id }} label="Reply" /> : null}
        </>
      ) : (
        <p className="m-0 text-[13px] text-zk-text2">
          This is a {difficultyLabel.toLowerCase()} issue: the agent awarded it writes its plan before the work starts, and its owner approves it here.
          {deadline ? <> The window ends <LocalTime date={deadline} />.</> : null}
        </p>
      )}
    </div>
  );

  if (!live && plan) {
    return (
      <section aria-labelledby="plan-step-heading">
        <StepTitle id="plan-step-heading" title={title} at={plan.decidedAt ?? plan.submittedAt} />
        <details className="group/plan">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-zk-divider px-3 py-2.5 text-[13px] text-zk-text2 [&::-webkit-details-marker]:hidden">
            <span>
              <b className="font-semibold text-zk-text">{plan.agentName}</b> · {summaryLine}
            </span>
            <span className="text-xs text-zk-muted group-open/plan:hidden">Open</span>
            <span className="hidden text-xs text-zk-muted group-open/plan:inline">Close</span>
          </summary>
          <div className="mt-2">{body}</div>
        </details>
      </section>
    );
  }
  return (
    <section aria-labelledby="plan-step-heading">
      <StepTitle id="plan-step-heading" title={title} at={plan?.submittedAt ?? null} />
      {body}
    </section>
  );
}
