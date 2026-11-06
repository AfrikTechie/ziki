"use client";

import { useActionState } from "react";
import Link from "next/link";
import { COMPARE_CATEGORIES, COMPARE_DIMENSIONS, FEATURE_STATUSES } from "@/lib/compare/catalog";
import type { FormValues } from "@/lib/compare/admin-values";
import { savePlatformAction, saveComparisonAction, type CompareFormState } from "@/app/(app)/superadmin/compare/actions";

const input = "w-full rounded-md border border-zk-border bg-zk-surface px-3 py-2 text-sm text-zk-text";
const label = "block text-sm font-medium text-zk-text";
const hint = "mt-1 text-xs text-zk-muted";

type FieldProps = { name: string; title: string; values: FormValues; help?: string; rows?: number; type?: string; required?: boolean };

function Field({ name, title, values, help, rows, type = "text", required }: FieldProps) {
  const id = `f-${name}`;
  return (
    <div>
      <label className={label} htmlFor={id}>{title}</label>
      {rows ? (
        <textarea id={id} name={name} rows={rows} defaultValue={values[name] ?? ""} className={input} required={required} />
      ) : (
        <input id={id} name={name} type={type} defaultValue={values[name] ?? ""} className={input} required={required} />
      )}
      {help ? <p className={hint}>{help}</p> : null}
    </div>
  );
}

function Check({ name, title, values }: { name: string; title: string; values: FormValues }) {
  return (
    <label className="flex items-center gap-2 text-sm text-zk-text">
      <input type="checkbox" name={name} defaultChecked={values[name] === "on"} />
      {title}
    </label>
  );
}

function Errors({ state }: { state: CompareFormState }) {
  return state.error ? <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p> : null;
}

export function PlatformForm({ initial, isZiki }: { initial: FormValues; isZiki: boolean }) {
  const [state, action, pending] = useActionState<CompareFormState, FormData>(savePlatformAction, {});
  // After a failed save the form shows what was submitted, not what was loaded.
  const values = state.values ?? initial;
  return (
    <form action={action} className="space-y-6" key={state.error ?? "initial"}>
      <input type="hidden" name="id" value={initial.id} />
      <Errors state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" title="Name" values={values} required />
        <Field name="slug" title="Slug" values={values} help={isZiki ? "Fixed for Ziki." : "Part of the comparison URL, e.g. ziki-vs-this-slug. Renaming it renames the pages."} required />
        <div>
          <label className={label} htmlFor="f-category">Category</label>
          <select id="f-category" name="category" defaultValue={values.category} className={input}>
            {COMPARE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <p className={hint}>Decides which capabilities the platform is compared on.</p>
        </div>
        <Field name="websiteUrl" title="Official website" values={values} type="url" required />
        <Field name="logoUrl" title="Logo path (optional)" values={values} help="A path on this site, e.g. /compare/logos/name.svg. Empty shows the initial." />
        <Field name="sortOrder" title="Order in lists" values={values} type="number" />
      </div>
      <Field name="description" title="What it is" values={values} rows={3} help="One or two neutral sentences. No claims you haven't checked." required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="useCases" title="Use cases" values={values} rows={4} help="One per line. Feeds “Which platform should you choose?”." />
        <Field name="pricingSummary" title="Pricing summary" values={values} rows={4} help="Only what the vendor publishes. Leave empty if you haven't checked." />
        <Field name="strengths" title="Strengths" values={values} rows={4} help="One per line, only verified ones." />
        <Field name="limitations" title="Limitations" values={values} rows={4} help="One per line. Don't list a limitation you haven't confirmed." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="sourceUrls" title="Sources" values={values} rows={3} help="Official pages and documents, one per line." />
        <Field name="lastVerifiedAt" title="Last verified" values={values} type="date" help="Required once any capability below is verified." />
      </div>

      <fieldset className="space-y-4 rounded-xl border border-zk-border p-4">
        <legend className="px-1 text-sm font-semibold text-zk-text">Capabilities</legend>
        <p className={hint}>Anything left as “Not verified” shows exactly that. A verified answer needs a source; “Not available” also needs a note on what you checked.</p>
        {COMPARE_DIMENSIONS.map((d) => (
          <div key={d.key} className="grid gap-3 border-t border-zk-border pt-4 first-of-type:border-t-0 first-of-type:pt-0 sm:grid-cols-[200px_1fr_1fr]">
            <div>
              <label className={label} htmlFor={`f-feature.${d.key}.status`}>{d.label}</label>
              <select id={`f-feature.${d.key}.status`} name={`feature.${d.key}.status`} defaultValue={values[`feature.${d.key}.status`]} className={`${input} mt-1`}>
                {FEATURE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <Field name={`feature.${d.key}.note`} title="Note" values={values} />
            <Field name={`feature.${d.key}.sourceUrl`} title="Source" values={values} type="url" />
          </div>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-6">
        <Check name="published" title="Published" values={values} />
        <Check name="popular" title="Popular (featured on /compare)" values={values} />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-zk-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving…" : "Save platform"}</button>
        <Link href="/superadmin/compare" className="text-sm text-zk-text2 hover:underline">Cancel</Link>
      </div>
    </form>
  );
}

export function ComparisonForm({ initial, platforms }: { initial: FormValues; platforms: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<CompareFormState, FormData>(saveComparisonAction, {});
  const values = state.values ?? initial;
  return (
    <form action={action} className="space-y-6" key={state.error ?? "initial"}>
      <input type="hidden" name="id" value={initial.id} />
      <Errors state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        {(["platformAId", "platformBId"] as const).map((name, i) => (
          <div key={name}>
            <label className={label} htmlFor={`f-${name}`}>{i === 0 ? "First platform (a)" : "Second platform (b)"}</label>
            <select id={`f-${name}`} name={name} defaultValue={values[name]} className={input} required>
              <option value="">Choose…</option>
              {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      <p className={hint}>The page shows Ziki first when it is in the pair, otherwise A to Z. Write “a” and “b” below as you chose them here; they are reordered when saved.</p>
      <Field name="title" title="Title" values={values} required />
      <Field name="summary" title="Summary" values={values} rows={2} help="Shown on cards and under the page headline. Up to 300 characters." />
      <Field name="intro" title="Introduction (optional)" values={values} rows={3} />
      <Field name="details" title="Detailed comparison" values={values} rows={5} help="One per line: heading | about a | about b" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="strengthsA" title="Strengths of a" values={values} rows={4} help="One per line. Empty uses the platform's own." />
        <Field name="strengthsB" title="Strengths of b" values={values} rows={4} />
        <Field name="limitationsA" title="Limitations of a" values={values} rows={4} />
        <Field name="limitationsB" title="Limitations of b" values={values} rows={4} />
      </div>
      <Field name="recommendations" title="Which should you choose?" values={values} rows={5} help="One per line: use case | a, b or either | optional note" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="seoTitle" title="SEO title (optional)" values={values} help="Up to 70 characters." />
        <Field name="seoDescription" title="SEO description (optional)" values={values} help="Up to 170 characters." />
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <Check name="published" title="Published" values={values} />
        <Check name="popular" title="Popular (featured on /compare)" values={values} />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-zk-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving…" : "Save comparison"}</button>
        <Link href="/superadmin/compare" className="text-sm text-zk-text2 hover:underline">Cancel</Link>
      </div>
    </form>
  );
}
