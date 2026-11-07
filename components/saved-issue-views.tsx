"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveIssueViewAction, deleteIssueViewAction } from "@/app/actions/saved-issue-views";
import { savedIssueViewHref, type SavedIssueView } from "@/lib/saved-issue-views";
import { projectRef } from "@/lib/project-paths";

export function SavedIssueViews({ org, slug, status, query, views, loadFailed = false }: {
  org: string;
  slug: string;
  status: string;
  query: string;
  views: SavedIssueView[];
  loadFailed?: boolean;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ref = projectRef(org, slug);
  const buttonClass = "min-h-11 rounded-lg border border-zk-border px-3 text-sm font-medium text-zk-text hover:bg-zk-chip disabled:opacity-50";

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      try {
        const result = await saveIssueViewAction(org, slug, { name, status, query });
        if ("error" in result) { setMessage(result.error); return; }
        setName("");
        setMessage("View saved.");
        router.refresh();
      } catch {
        setMessage("Could not save this view. Check your connection and try again.");
      }
    });
  }

  function remove(view: SavedIssueView) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await deleteIssueViewAction(org, slug, view.id);
        if ("error" in result) { setMessage(result.error); return; }
        setMessage("View deleted.");
        router.refresh();
      } catch {
        setMessage("Could not delete this view. Check your connection and try again.");
      }
    });
  }

  return (
    <details className="w-full rounded-xl border border-zk-border bg-zk-surface p-3 print:hidden">
      <summary className="cursor-pointer text-sm font-semibold text-zk-text">Saved views</summary>
      <p className="mt-2 text-sm text-zk-muted">Save this issue list&apos;s filters and order. Your views are private to you in this project.</p>
      {loadFailed ? (
        <div role="alert" className="mt-3 text-sm">
          <p>Could not load your saved views.</p>
          <button type="button" className={buttonClass} onClick={() => router.refresh()}>Retry loading views</button>
        </div>
      ) : (
        <ul aria-label="Saved issue views" className="mt-3 space-y-2">
          {views.length === 0 ? <li className="text-sm text-zk-muted">Your saved views will appear here.</li> : views.map((view) => (
            <li key={view.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link className="min-w-0 break-words text-sm font-medium text-zk-accent underline" href={savedIssueViewHref(ref, view)}>{view.name}</Link>
              <button type="button" disabled={pending} className={buttonClass} aria-label={`Delete view ${view.name}`} onClick={() => remove(view)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm text-zk-text">
          View name
          <input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} disabled={pending}
            className="mt-1 block min-h-11 w-full rounded-lg border border-zk-border bg-zk-bg px-3 text-zk-text" />
        </label>
        <button type="submit" disabled={pending || loadFailed} className={buttonClass}>{pending ? "Saving changes…" : "Save current view"}</button>
      </form>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-zk-text2">{message}</p>
    </details>
  );
}
