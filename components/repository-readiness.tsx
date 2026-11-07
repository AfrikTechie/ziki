"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkDelivery, recheckRepositories } from "@/app/(app)/projects/readiness/actions";
import { readinessState, type DeliveryReadinessResult, type ReadinessCheck, type ReadinessResult } from "@/lib/github/repository-readiness-types";

const tone = {
  pass: "text-zk-ok-fg bg-zk-ok-bg",
  warning: "text-zk-warn-fg bg-zk-warn-bg",
  fail: "text-zk-bad-fg bg-zk-bad-bg",
  unknown: "text-zk-muted bg-zk-chip",
};
const stateLabel = { pass: "Passed", warning: "Review", fail: "Failed", unknown: "Not checked" };

function CheckResult({ check }: { check: ReadinessCheck }) {
  return <li className="space-y-1 border-t border-zk-border py-3 first:border-0">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone[check.state]}`}>{stateLabel[check.state]}</span>
      <span className="text-sm font-semibold capitalize">{check.key}</span>
    </div>
    <p className="text-sm text-zk-text2">{check.message}</p>
  </li>;
}

export function RepositoryReadiness({ initial }: { initial: ReadinessResult }) {
  const [result, setResult] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryReadinessResult | null>(null);
  const [checkingDelivery, setCheckingDelivery] = useState(false);
  const refreshLock = useRef(false);
  const deliveryLock = useRef(false);
  const report = result.ok ? result.report : null;

  const recheck = async () => {
    if (refreshLock.current || deliveryLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    setError(null);
    setDelivery(null);
    try {
      const next = await recheckRepositories();
      if (next.ok) setResult(next);
      else setError(next.error);
    } catch {
      setError("Could not recheck repositories. Reload the page to confirm your access, then try again.");
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  };

  const submitDelivery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (deliveryLock.current || refreshLock.current) return;
    const values = new FormData(event.currentTarget);
    deliveryLock.current = true;
    setCheckingDelivery(true);
    setDelivery(null);
    try {
      setDelivery(await checkDelivery({ projectId: values.get("projectId"), pullRequestUrl: values.get("pullRequestUrl") }));
    } catch {
      setDelivery({ ok: false, error: "Could not check this delivery. Reload the page to confirm your access, then try again." });
    } finally {
      deliveryLock.current = false;
      setCheckingDelivery(false);
    }
  };

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10 text-zk-text [overflow-wrap:anywhere]">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-extrabold">Repository readiness</h1>
        <p className="text-sm text-zk-text2">Check repositories, branches and GitHub App access for this organisation before delivering work. Checks read GitHub; they do not change repositories or project settings.</p>
        {report ? <p className="text-xs text-zk-muted">Checked <time dateTime={report.checkedAt}>{report.checkedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time></p> : null}
      </div>
      <Button disabled={refreshing || checkingDelivery} onClick={() => { void recheck(); }} aria-busy={refreshing}>{refreshing ? "Rechecking…" : "Recheck"}</Button>
    </header>
    {refreshing ? <p role="status" aria-live="polite">Checking repositories… Previous results remain below until checks finish.</p> : null}
    {error || !result.ok ? <p role="alert" className="rounded-xl bg-zk-bad-bg p-4 text-zk-bad-fg">{error || (!result.ok ? result.error : "")}</p> : null}
    {report?.projects.length === 0 ? <section className="rounded-2xl border border-zk-border bg-zk-surface p-6">
      <h2 className="text-lg font-bold">No active projects</h2>
      <p className="mt-2 text-sm text-zk-text2">Create a project in your organisation to check its repository.</p>
      <Link href="/home" className="mt-3 inline-block font-semibold text-zk-accent underline">Open projects</Link>
    </section> : null}
    {report?.projects.map((project) => {
      const checks = [...project.repositories.flatMap((repository) => repository.checks), ...project.deliveries.map((item) => item.check)];
      return <section key={project.id} aria-labelledby={`project-${project.id}`} className="rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id={`project-${project.id}`} className="text-xl font-bold">{project.name}</h2><p className="text-sm text-zk-text2">{readinessState(checks)}</p></div>
          <Link href={`/projects/${encodeURIComponent(project.slug)}/settings?section=github`} className="text-sm font-semibold text-zk-accent underline">Project repository settings<span className="sr-only"> for {project.name}</span></Link>
        </div>
        {project.repositories.map((repository, index) => <div key={`${repository.name}-${index}`} className="mt-4 rounded-xl border border-zk-border p-4">
          <h3 className="font-bold">{repository.label}</h3>
          <p className="my-1 text-sm">{repository.url ? <a href={repository.url} target="_blank" rel="noopener noreferrer" className="text-zk-accent underline">{repository.name}</a> : repository.name}</p>
          <p className="text-xs text-zk-muted">Default: {repository.defaultBranch || "Not verified"} · Delivery: {repository.deliveryBranch || "Not verified"}</p>
          <ul className="mt-3">{repository.checks.map((item) => <CheckResult key={item.key} check={item} />)}</ul>
        </div>)}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold">Recent linked PR URL checks ({project.deliveries.length})</summary>
          <p className="my-2 text-zk-muted">Up to 20 recent linked PRs. These compare URLs only; use the delivery checker below to verify an actual PR base and branch on GitHub.</p>
          {!project.deliveries.length ? <p className="text-zk-text2">No linked deliveries to compare yet.</p> : <ul>{project.deliveries.map((item, index) => <li key={index} className="my-3">
            <p className={`font-semibold ${tone[item.check.state]}`}>Issue {item.issueNumber}: {stateLabel[item.check.state]}</p>
            <p>{item.check.message}</p>
            {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-zk-accent underline">Open pull request</a> : null}
          </li>)}</ul>}
        </details>
      </section>;
    })}
    {report && report.projects.length > 0 ? <section className="space-y-4 rounded-2xl border border-zk-border bg-zk-surface p-5 sm:p-6">
      <h2 className="text-xl font-bold">Check a delivery before submitting it</h2>
      <p className="text-sm text-zk-text2">Compare the target repository with the project’s allowed repositories, then verify the PR’s actual base repository, delivery branch and installation access.</p>
      <form onSubmit={(event) => { void submitDelivery(event); }} className="flex flex-col gap-4">
        <label htmlFor="readiness-project" className="space-y-1 text-sm font-semibold">Project
          <select id="readiness-project" name="projectId" required disabled={checkingDelivery || refreshing} className="block w-full rounded-lg border border-zk-border bg-zk-bg p-3 text-zk-text">
            {report.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label htmlFor="readiness-pr" className="space-y-1 text-sm font-semibold">Pull request URL
          <Input id="readiness-pr" name="pullRequestUrl" type="url" required maxLength={1000} disabled={checkingDelivery || refreshing} placeholder="Paste the GitHub pull request link" className="border-zk-border bg-zk-bg text-zk-text" />
        </label>
        <Button type="submit" disabled={checkingDelivery || refreshing} aria-busy={checkingDelivery} className="self-start">{checkingDelivery ? "Checking delivery…" : "Check delivery"}</Button>
      </form>
      {delivery ? <div role={delivery.ok && delivery.delivery.check.state === "pass" ? "status" : "alert"} aria-live="polite" className="rounded-xl border border-zk-border p-4">
        {delivery.ok ? <><p className="font-semibold">{stateLabel[delivery.delivery.check.state]}</p><p className="mt-1 text-sm">{delivery.delivery.check.message}</p></> : delivery.error}
      </div> : null}
    </section> : null}
  </div>;
}
