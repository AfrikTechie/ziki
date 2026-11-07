"use client";

import { useActionState, useEffect, useState } from "react";
import { takeItBackAction, type TakeItBackResult } from "@/app/actions/take-it-back";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import type { TakeItBackView } from "@/lib/take-it-back";

type ChangedFile = { filename: string; additions: number; deletions: number };

/**
 * "Take it back" (#851): shown to an organisation owner or admin beside Status
 * on a merged issue. It previews the merged pull request's files, requires a
 * reason, and confirms before the revert issue is filed. The server enforces
 * the same rules.
 */
export function TakeItBackPanel({ view }: { view: TakeItBackView }) {
  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState<TakeItBackResult | undefined, FormData>(
    takeItBackAction,
    undefined,
  );

  if (view.state !== "available") {
    return (
      <p data-testid="take-it-back-note" className="m-0 text-xs leading-[1.5] text-zk-muted">
        {view.state === "too_old"
          ? `Take it back is closed: this merged more than 30 days ago${view.endsAt ? ` (the window ended ${day(view.endsAt)})` : ""}.`
          : view.existing?.message}
      </p>
    );
  }

  return (
    <div data-testid="take-it-back" className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 items-center rounded-full border border-zk-border bg-zk-surface px-3 text-xs font-semibold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-accent"
      >
        {open ? "Cancel" : "Take it back"}
      </button>
      {open ? (
        <form aria-label="Take it back" action={action} className="flex w-full flex-col gap-2.5">
          <input type="hidden" name="issueId" value={view.issueId} />
          <TakeItBackPreview view={view} />
          <label className="text-xs font-semibold text-zk-text" htmlFor="take-it-back-reason">
            Why are you taking it back?
          </label>
          <textarea
            id="take-it-back-reason"
            name="reason"
            required
            minLength={10}
            maxLength={1000}
            rows={3}
            placeholder="Say what the merge broke or why it should not stay."
            className="w-full rounded-xl border border-zk-border bg-zk-surface px-3 py-2 text-xs text-zk-text outline-none placeholder:text-zk-muted focus:border-zk-accent focus:ring-2 focus:ring-zk-accent/30"
          />
          <ConfirmSubmitButton
            confirm={{
              title: `Take back issue #${view.issueNumber}?`,
              body: "This creates a revert issue for an agent. Code is undone; data saved after the merge is not. When the revert merges, the issue returns to Open with your reason.",
              confirmLabel: "Take it back",
            }}
          >
            {pending ? "Creating revert…" : "Create revert issue"}
          </ConfirmSubmitButton>
          {result && !result.ok ? (
            <p role="alert" className="m-0 text-xs leading-[1.5] text-zk-bad-fg">
              {result.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function TakeItBackPreview({ view }: { view: TakeItBackView }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!view.filesUrl) return;
    const controller = new AbortController();
    fetch(view.filesUrl, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("preview unavailable"))))
      .then((data: unknown) => {
        if (!Array.isArray(data)) throw new Error("preview unavailable");
        setFiles(
          data.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const file = entry as Record<string, unknown>;
            return typeof file.filename === "string"
              ? [{
                  filename: file.filename,
                  additions: typeof file.additions === "number" ? file.additions : 0,
                  deletions: typeof file.deletions === "number" ? file.deletions : 0,
                }]
              : [];
          }),
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [view.filesUrl]);

  const added = files?.reduce((total, file) => total + file.additions, 0) ?? 0;
  const removed = files?.reduce((total, file) => total + file.deletions, 0) ?? 0;

  return (
    <div data-testid="take-it-back-preview" className="flex w-full flex-col gap-1.5 rounded-xl border border-zk-border bg-zk-chip/40 px-3 py-2.5 text-xs leading-[1.5] text-zk-text2">
      <p className="m-0 font-semibold text-zk-text">What will be undone</p>
      {view.pullRequestUrl ? (
        <p className="m-0">
          Merged pull request:{" "}
          <a href={view.pullRequestUrl} target="_blank" rel="noreferrer" className="font-semibold text-zk-accent hover:underline">
            {pullLabel(view.pullRequestUrl)}
          </a>
          {view.mergedInto ? <> into <code>{view.mergedInto}</code></> : null}
          {view.mergeCommitSha ? <> at <code>{view.mergeCommitSha.slice(0, 7)}</code></> : null}.
        </p>
      ) : (
        <p className="m-0">The fix this issue merged. No pull request is linked, so Ziki cannot list its files.</p>
      )}
      {view.filesUrl ? (
        files ? (
          <p className="m-0">
            {files.length === 0
              ? "The pull request lists no files."
              : `${files.length} file${files.length === 1 ? "" : "s"} · +${added} −${removed}`}
          </p>
        ) : failed ? (
          <p className="m-0">Files and line counts are on the pull request.</p>
        ) : (
          <p className="m-0">Reading the pull request…</p>
        )
      ) : null}
      {files && files.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {files.slice(0, 5).map((file) => (
            <li key={file.filename} className="flex min-w-0 items-baseline gap-1.5">
              <code className="min-w-0 break-all text-[11px]">{file.filename}</code>
              <span className="ml-auto shrink-0 tabular-nums text-[11px] text-zk-muted">+{file.additions} −{file.deletions}</span>
            </li>
          ))}
          {files.length > 5 ? <li className="text-[11px] text-zk-muted">and {files.length - 5} more</li> : null}
        </ul>
      ) : null}
      <p className="m-0 text-[11px] text-zk-muted">
        Code only: data saved after the merge is not changed. The original issue returns to Open when the revert merges.
        {view.mergedAt ? ` Merged ${day(view.mergedAt)}.` : ""}
      </p>
    </div>
  );
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function pullLabel(url: string): string {
  const match = url.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  return match ? `#${match[1]}` : url;
}
