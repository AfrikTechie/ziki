"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  addProjectRepositoryAction,
  removeProjectRepositoryAction,
  type ProjectRepositoryActionResult,
} from "./repositories-actions";

type ProjectRepository = {
  id: string;
  url: string;
  label: string | null;
  branch: string | null;
  githubInstallationId: string | null;
};

function ActionFeedback({ result }: { result: ProjectRepositoryActionResult | undefined }) {
  if (!result) return null;
  return result.ok ? (
    <p className="text-xs text-zk-ok-fg" role="status">Saved.</p>
  ) : (
    <p className="text-xs text-zk-bad-fg" role="alert">{result.error}</p>
  );
}

function AddRepositoryForm({ projectSlug }: { projectSlug: string }) {
  const [result, action, pending] = useActionState<ProjectRepositoryActionResult | undefined, FormData>(addProjectRepositoryAction, undefined);
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <input type="hidden" name="slug" value={projectSlug} />
      <label className="space-y-1 text-sm font-medium text-zk-text" htmlFor="new-repository-url">
        Repository URL
        <Input id="new-repository-url" name="url" type="url" inputMode="url" required placeholder="https://github.com/owner/api" />
      </label>
      <label className="space-y-1 text-sm font-medium text-zk-text" htmlFor="new-repository-label">
        Label <span className="font-normal text-zk-muted">(optional)</span>
        <Input id="new-repository-label" name="label" maxLength={40} placeholder="API" />
      </label>
      <label className="space-y-1 text-sm font-medium text-zk-text" htmlFor="new-repository-branch">
        Branch <span className="font-normal text-zk-muted">(optional)</span>
        <Input id="new-repository-branch" name="branch" maxLength={100} placeholder="dev" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add repository"}</Button>
        <ActionFeedback result={result} />
      </div>
    </form>
  );
}

function RepositoryRow({
  repository,
  projectSlug,
  projectConnected,
}: {
  repository: ProjectRepository;
  projectSlug: string;
  projectConnected: boolean;
}) {
  const [result, setResult] = useState<ProjectRepositoryActionResult | undefined>();
  const [removing, startRemove] = useTransition();
  const confirm = useConfirm();
  const name = repository.url.replace(/^https:\/\/github\.com\//, "");
  const status = repository.githubInstallationId
    ? "Connected with its own installation"
    : projectConnected
      ? "Uses the project's GitHub App"
      : "Not connected";

  async function remove() {
    const approved = await confirm({
      title: `Remove ${name}?`,
      body: "Pull requests in this repository can no longer be linked or merged for this project.",
      confirmLabel: "Remove repository",
      tone: "danger",
    });
    if (!approved) return;
    startRemove(async () => setResult(await removeProjectRepositoryAction(projectSlug, repository.id)));
  }

  return (
    <li className="flex flex-col gap-3 border-t border-zk-border py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-semibold text-zk-text">
          {repository.label ? <span className="mr-2 rounded-full bg-zk-chip px-2 py-0.5 text-xs font-medium text-zk-text2">{repository.label}</span> : null}
          <a href={repository.url} className="hover:underline" target="_blank" rel="noreferrer">{name}</a>
        </p>
        <p className="text-xs text-zk-muted">
          {repository.branch ? `Fixes go into ${repository.branch}. ` : ""}{status}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* A direct link, like the project's Connect GitHub App button (#194). */}
        <a
          href={`/projects/${encodeURIComponent(projectSlug)}/settings/github?repository=${encodeURIComponent(repository.id)}`}
          className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-card px-3.5 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
        >
          {repository.githubInstallationId ? "Change installation" : "Connect its own installation"}
        </a>
        <Button type="button" variant="danger-secondary" disabled={removing} onClick={remove}>
          {removing ? "Removing…" : "Remove"}
        </Button>
        <ActionFeedback result={result} />
      </div>
    </li>
  );
}

export function ProjectRepositoriesManager({
  projectSlug,
  repositories,
  projectConnected,
}: {
  projectSlug: string;
  repositories: ProjectRepository[];
  projectConnected: boolean;
}) {
  return (
    <div className="border-t border-zk-border pt-5" aria-labelledby="project-repositories-heading">
      <h2 id="project-repositories-heading" className="text-base font-semibold text-zk-text">More repositories</h2>
      <p className="mt-1 text-sm text-zk-text2">
        Add the project&apos;s other repositories, for example its API or mobile app. Pull requests in any of them can be
        linked, reviewed and merged. A repository in another GitHub organization needs its own installation.
      </p>
      <AddRepositoryForm projectSlug={projectSlug} />
      {repositories.length ? (
        <ul>
          {repositories.map((repository) => (
            <RepositoryRow key={repository.id} repository={repository} projectSlug={projectSlug} projectConnected={projectConnected} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-zk-border py-4 text-sm text-zk-muted">Only the main repository so far.</p>
      )}
    </div>
  );
}
