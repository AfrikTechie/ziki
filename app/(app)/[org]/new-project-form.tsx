"use client";

import { useActionState, useState } from "react";
import { createProjectAction, type ProjectActionResult } from "@/app/(app)/projects/actions";
import { PROJECT_NAME_MAX } from "@/app/(app)/projects/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * New project, on the organisation's Projects page (`/<org>`).
 * Open from the start when the organisation has no projects yet.
 */
export function NewProjectForm({ orgSlug, startOpen = false }: { orgSlug?: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [isOpenForContributors, setIsOpenForContributors] = useState(false);
  const [result, action, pending] = useActionState<ProjectActionResult | undefined, FormData>(createProjectAction, undefined);
  const error = result?.error;

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        New project
      </Button>
    );
  }

  return (
    <form action={action} noValidate className="w-full space-y-4 rounded-2xl border border-zk-border bg-zk-surface px-5 py-4">
      {orgSlug ? <input type="hidden" name="orgSlug" value={orgSlug} /> : null}

      <div>
        <label htmlFor="new-project-name" className="block text-sm font-medium text-zk-text">
          Project name
        </label>
        <p className="mt-0.5 text-xs text-zk-muted">A product or area of the organisation, such as a web app or iOS app.</p>
        <div className="mt-2">
          <Input
            id="new-project-name"
            name="name"
            placeholder="Web app"
            required
            maxLength={PROJECT_NAME_MAX + 20}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "new-project-error" : undefined}
            className="sm:max-w-md"
          />
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-zk-border bg-zk-card p-3.5">
        <span className="block text-xs font-semibold text-zk-text">Visibility</span>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs font-medium text-zk-text cursor-pointer">
            <input
              type="radio"
              name="visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => {
                setVisibility("private");
                setIsOpenForContributors(false);
              }}
              disabled={pending}
              className="text-zk-accent focus:ring-zk-accent"
            />
            <span>Private</span>
          </label>
          <p className="pl-5 text-[11px] text-zk-muted">
            Only members of this organisation can view, open, and contribute to this project.
          </p>

          <label className="flex items-center gap-2 text-xs font-medium text-zk-text cursor-pointer">
            <input
              type="radio"
              name="visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
              disabled={pending}
              className="text-zk-accent focus:ring-zk-accent"
            />
            <span>Public</span>
          </label>
          <p className="pl-5 text-[11px] text-zk-muted">
            Listed on /discover and readable by any signed-in user. Non-members can view issues, ideas, and notes in read-only mode unless accepted as contributors.
          </p>
        </div>

        {visibility === "public" ? (
          <div className="mt-2 border-t border-zk-border pt-2 space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-zk-text cursor-pointer">
              <input
                type="checkbox"
                name="isOpenForContributors"
                value="true"
                checked={isOpenForContributors}
                onChange={(e) => setIsOpenForContributors(e.target.checked)}
                disabled={pending}
                className="rounded border-zk-border text-zk-accent focus:ring-zk-accent"
              />
              <span>Open for collaboration</span>
            </label>
            <p className="pl-5 text-[11px] text-zk-muted">
              Allow external signed-in contributors to apply to join this project.
            </p>

            {isOpenForContributors ? (
              <div className="pt-2">
                <label htmlFor="new-project-guidelines" className="block text-xs font-medium text-zk-text">
                  Contributor guidelines (optional)
                </label>
                <Textarea
                  id="new-project-guidelines"
                  name="contributorGuidelines"
                  placeholder="Explain guidelines or requirements for external contributors..."
                  maxLength={4000}
                  rows={3}
                  disabled={pending}
                  className="mt-1 text-xs"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </Button>
        {!startOpen ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      {error ? (
        <p id="new-project-error" role="alert" className="mt-2 text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}
