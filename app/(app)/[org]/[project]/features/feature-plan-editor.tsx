"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { findFeatureWorkAction, proposeFeaturePlanAction, publishFeaturePlanAction, saveFeaturePlanAction } from "@/app/actions/feature-plans";
import type { FeatureDraft, FeatureRequest, FeatureScope } from "@/lib/validations/feature-plan";
import type { FeatureWork } from "@/lib/feature-plan-generation";

const field = "mt-1 w-full rounded-lg border border-zk-border bg-zk-bg px-3 py-2 text-sm text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent";
const button = "rounded-lg border border-zk-border px-4 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip disabled:cursor-wait disabled:opacity-50";
const primary = `${button} bg-zk-accent text-white hover:opacity-90`;
const blankTask = () => ({ title: "", description: "", acceptanceCriteria: [""], scope: "first" as FeatureScope, existing: null as string | null });

function Criteria({ label, value, disabled, onChange }: { label: string; value: string[]; disabled: boolean; onChange: (value: string[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-semibold">{label}</legend>
    {value.map((line, index) => <div className="flex items-start gap-2" key={index}>
      <input aria-label={`${label} ${index + 1}`} className={field} value={line} disabled={disabled} maxLength={200} required minLength={3} onChange={(event) => onChange(value.map((item, i) => i === index ? event.target.value : item))} />
      {!disabled && value.length > 1 ? <button type="button" className={button} aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove</button> : null}
    </div>)}
    {!disabled && value.length < 4 ? <button type="button" className={button} onClick={() => onChange([...value, ""])}>Add criterion</button> : null}
  </fieldset>;
}

export function FeaturePlanEditor({ projectId, basePath, initial }: {
  projectId: string;
  basePath: string;
  initial?: { id: string; version: number; title: string; request: string; draft: FeatureDraft };
}) {
  const router = useRouter();
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [request, setRequest] = useState<FeatureRequest>({ title: initial?.title ?? "", request: initial?.request ?? "" });
  const [constraints, setConstraints] = useState("");
  const [draft, setDraft] = useState<FeatureDraft | null>(initial?.draft ?? null);
  const [work, setWork] = useState<FeatureWork[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function run(work: () => Promise<void>) {
    setError(""); setMessage("");
    startTransition(async () => {
      try { await work(); } catch { setError("The request could not finish. Your draft is still here; please try again."); }
    });
  }
  async function propose() {
    const input = {
      title: request.request.trim().replace(/\s+/g, " ").slice(0, 120),
      request: `${request.request.trim()}${constraints.trim() ? `\n\nConstraints:\n${constraints.trim()}` : ""}`,
    };
    const result = await proposeFeaturePlanAction(projectId, input);
    if (!result.ok) { setError(result.error); return; }
    if (!result.value.draft) {
      setError("AI planning is currently unavailable. Your idea and constraints are still here. Please try again later; no work has been created.");
      return;
    }
    setRequest(input);
    setWork(result.value.work);
    setDraft(result.value.draft);
    setMessage("AI proposal ready. Review the first version, later improvements and definition of done. Nothing has been published.");
  }
  const updateTask = (index: number, patch: Partial<FeatureDraft["tasks"][number]>) => {
    if (draft) setDraft({ ...draft, tasks: draft.tasks.map((task, i) => i === index ? { ...task, ...patch } : task) });
  };
  return <form noValidate className="space-y-6" onSubmit={(event) => {
    event.preventDefault();
    if (!draft) { run(propose); return; }
    run(async () => {
      const result = await saveFeaturePlanAction({ projectId, id, version: initial?.version ?? 1, creating: !initial, request, draft });
      if (!result.ok) { setError(result.error); return; }
      router.push(`${basePath}/${result.value.id}`);
    });
  }}>
    {!draft ? <section className="space-y-4 rounded-2xl border border-zk-border bg-zk-surface p-5" aria-labelledby="feature-request-heading">
      <h2 id="feature-request-heading" className="font-semibold">What would you like to add?</h2>
      <p className="text-sm text-zk-text2">AI can help turn your feature idea into actionable tasks. Just describe the idea and any constraints; we use your project context and related ideas and issues.</p>
      <label className="block text-sm font-semibold">Your feature idea<textarea className={field} rows={5} value={request.request} disabled={pending} required minLength={20} maxLength={3000} placeholder="Let customers book an available appointment and receive confirmation." onChange={(event) => setRequest({ ...request, request: event.target.value })} /></label>
      <label className="block text-sm font-semibold">Constraints (optional)<textarea className={field} rows={2} value={constraints} disabled={pending} maxLength={900} placeholder="For example: use our existing calendar; email only for the first version; no payments yet." onChange={(event) => setConstraints(event.target.value)} /></label>
      <button className={primary} disabled={pending} type="submit">{pending ? "AI is preparing your plan…" : "Generate plan with AI"}</button>
      <p className="text-sm text-zk-text2">Your request and relevant project context are sent to Ziki’s AI provider. Suggestions need your review; nothing is published automatically.</p>
    </section> : null}
    {draft ? <>
      <section className="space-y-4" aria-labelledby="ai-proposal-heading">
        <h2 id="ai-proposal-heading" className="text-xl font-semibold">Review your proposed plan</h2>
        <p className="text-sm text-zk-text2">AI suggestions can be wrong. Check the scope and linked work; edit only what you need.</p>
        <div className="rounded-2xl border border-zk-border bg-zk-surface p-5 space-y-3">
          <h3 className="font-semibold">The outcome</h3><p>{draft.outcome}</p>
          <h3 className="font-semibold">Definition of done</h3><ul className="list-disc pl-5 text-sm space-y-1">{draft.definitionOfDone.map((line, i) => <li key={i}>{line}</li>)}</ul>
        </div>
        {(["first", "later"] as const).map((scope) => <div key={scope} className="space-y-3">
          <h3 className="font-semibold">{scope === "first" ? "First usable version" : "Later improvements"}</h3>
          {draft.tasks.filter((task) => task.scope === scope).map((task, i) => <article key={i} className="space-y-2 rounded-2xl border border-zk-border bg-zk-surface p-5">
            <h4 className="font-semibold">{task.title}</h4><p className="text-sm">{task.description}</p>
            <ul className="list-disc pl-5 text-sm">{task.acceptanceCriteria.map((line, j) => <li key={j}>{line}</li>)}</ul>
            <p className="text-sm text-zk-text2">{task.existing ? "Builds on existing work" : "Proposed new idea"}</p>
            {work.filter((item) => item.ref === task.existing).map((item) => <Link key={item.ref} target="_blank" rel="noopener noreferrer" className="block text-sm text-zk-accent underline" href={`${basePath.replace(/\/features$/, "")}/${item.ref.startsWith("idea:") ? "ideas/" : ""}${item.number}`}>{item.ref.startsWith("idea:") ? "Idea" : "Issue"} #{item.number}: {item.title}</Link>)}
          </article>)}
          {!draft.tasks.some((task) => task.scope === scope) ? <p className="text-sm text-zk-text2">No optional improvements proposed.</p> : null}
        </div>)}
      </section>
      <details className="rounded-2xl border border-zk-border p-4">
        <summary className="cursor-pointer font-semibold">Edit proposal (optional)</summary>
        <div className="mt-4 space-y-6">
          <label className="block text-sm font-semibold">Feature name<input className={field} value={request.title} required minLength={3} maxLength={120} onChange={(event) => setRequest({ ...request, title: event.target.value })} /></label>
      <fieldset disabled={pending} className="space-y-4 rounded-2xl border border-zk-border bg-zk-surface p-5">
        <legend className="px-1 font-semibold">Success criteria</legend>
        <label className="block text-sm font-semibold">The user outcome<textarea className={field} rows={2} value={draft.outcome} required minLength={10} maxLength={600} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })} /></label>
        <Criteria label="Definition of done" value={draft.definitionOfDone} disabled={pending} onChange={(definitionOfDone) => setDraft({ ...draft, definitionOfDone })} />
        <p className="text-sm text-zk-text2">Describe an observable end-to-end result. This is the feature’s success criteria; linked work statuses do not automatically verify it.</p>
      </fieldset>
      <section className="space-y-3 rounded-2xl border border-zk-border bg-zk-surface p-5" aria-labelledby="related-work-heading">
        <h2 id="related-work-heading" className="font-semibold">Build on existing work</h2>
        <p className="text-sm text-zk-text2">Search this project before adding new ideas. Results are limited matches, not a complete duplicate check or proof that a feature exists.</p>
        <div className="flex gap-2"><label className="flex-1 text-sm">Search ideas and issues<input className={field} value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} /></label><button className={`${button} self-end`} disabled={pending || search.trim().length < 3} type="button" onClick={() => run(async () => {
          const result = await findFeatureWorkAction(projectId, search);
          if (!result.ok) { setError(result.error); return; }
          setWork((previous) => [...previous.filter((item) => !result.value.some((next) => next.ref === item.ref)), ...result.value]);
          setMessage(result.value.length ? "Related work updated. You can choose a result on each work item below." : "No matching work found. Try another search term.");
        })}>Find work</button></div>
        {work.length ? <ul className="space-y-2">{work.map((item) => <li key={item.ref} className="text-sm"><Link target="_blank" rel="noopener noreferrer" className="font-semibold text-zk-accent underline" href={`${basePath.replace(/\/features$/, "")}/${item.ref.startsWith("idea:") ? "ideas/" : ""}${item.number}`}>{item.ref.startsWith("idea:") ? "Idea" : "Issue"} #{item.number}: {item.title}</Link><span className="ml-2 text-zk-text2">{item.state}</span></li>)}</ul> : null}
      </section>
      <section className="space-y-4" aria-labelledby="plan-work-heading">
        <h2 id="plan-work-heading" className="font-semibold">Work items</h2>
        <p className="text-sm text-zk-text2">First version should deliver the core outcome. Later improvements stay unpublished until you choose to publish them. Linking existing work does not change it or stop work already underway.</p>
        {draft.tasks.map((task, index) => <fieldset disabled={pending} key={index} className="space-y-4 rounded-2xl border border-zk-border bg-zk-surface p-5">
          <legend className="px-1 font-semibold">Work item {index + 1}</legend>
          <div className="flex flex-wrap gap-3"><label className="min-w-48 flex-1 text-sm font-semibold">Title<input className={field} value={task.title} required minLength={3} maxLength={160} onChange={(event) => updateTask(index, { title: event.target.value })} /></label>
            <label className="text-sm font-semibold">Scope<select className={field} value={task.scope} onChange={(event) => updateTask(index, { scope: event.target.value as FeatureScope })}><option value="first">First version</option><option value="later">Later improvement</option></select></label></div>
          <label className="block text-sm font-semibold">What should change?<textarea className={field} rows={3} value={task.description} required minLength={10} maxLength={1200} onChange={(event) => updateTask(index, { description: event.target.value })} /></label>
          <Criteria label={`Item ${index + 1} acceptance criteria`} value={task.acceptanceCriteria} disabled={pending} onChange={(acceptanceCriteria) => updateTask(index, { acceptanceCriteria })} />
          <label className="block text-sm font-semibold">Reuse existing work or create a new idea<select className={field} value={task.existing ?? ""} onChange={(event) => updateTask(index, { existing: event.target.value || null })}>
            <option value="">Create a new idea when published</option>
            {task.existing && !work.some((item) => item.ref === task.existing) ? <option value={task.existing}>Saved link: {task.existing} (checked again when publishing)</option> : null}
            {work.map((item) => <option key={item.ref} value={item.ref}>{item.ref.startsWith("idea:") ? "Idea" : "Issue"} #{item.number}: {item.title}</option>)}
          </select></label>
          {task.existing ? <p className="text-sm text-zk-text2">This will link the existing work without editing its requirements. Check that it satisfies this item’s acceptance criteria.</p> : null}
          {draft.tasks.length > 1 ? <button className={button} type="button" onClick={() => setDraft({ ...draft, tasks: draft.tasks.filter((_, i) => i !== index) })}>Remove item {index + 1}</button> : null}
        </fieldset>)}
        {draft.tasks.length < 8 ? <button className={button} disabled={pending} type="button" onClick={() => setDraft({ ...draft, tasks: [...draft.tasks, blankTask()] })}>Add work item</button> : null}
      </section>
        </div>
      </details>
      <div className="space-y-2"><button className={primary} disabled={pending} type="submit">{pending ? "Saving…" : "Save draft and review"}</button><p className="text-sm text-zk-text2">Saving creates no ideas or issues. You’ll review the saved plan before publishing.</p></div>
    </> : null}
    {error ? <p role="alert" className="rounded-lg border border-red-400 p-3 text-sm text-red-600">{error}</p> : null}
    <p role="status" aria-live="polite" className="text-sm text-zk-text2">{message}</p>
  </form>;
}

export function PublishFeaturePlan({ projectId, id, version, scope, newIdeas, links }: { projectId: string; id: string; version: number; scope: FeatureScope; newIdeas: number; links: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return <div className="space-y-2">
    <p className="text-sm text-zk-text2">This will create {newIdeas} {newIdeas === 1 ? "idea" : "ideas"} and link {links} existing work {links === 1 ? "item" : "items"}. New ideas follow Ziki’s normal verdict and delivery workflow.{scope === "first" ? " Publication locks this plan’s scope and shares the plan with project members." : " Later work will enter the idea workflow now."}</p>
    <button className={primary} disabled={pending} onClick={() => {
      setError(""); setMessage("");
      startTransition(async () => {
        try {
          const result = await publishFeaturePlanAction({ projectId, id, version, scope });
          if (!result.ok) { setError(result.error); return; }
          setMessage(result.value.replayed ? "These items were already published. No duplicates were created." : `Published: ${result.value.created} new ideas and ${result.value.linked} existing work links.`);
          router.refresh();
        } catch { setError("Publication could not be confirmed. Retry safely; the same items will not be created twice."); }
      });
    }}>{pending ? "Publishing…" : scope === "first" ? "Publish first version" : "Publish later improvements"}</button>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}<p role="status" className="text-sm text-zk-text2">{message}</p>
  </div>;
}
