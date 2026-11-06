"use client";

import { useActionState, useState } from "react";
import { createProjectAction, type ProjectActionResult } from "@/app/(app)/projects/actions";
import { PROJECT_NAME_MAX } from "@/app/(app)/projects/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * New project, on the organisation's Projects page (`/<org>`). A name is all it
 * needs; the new project opens on its Ideas. Open from the start when the
 * organisation has no projects yet.
 */
export function NewProjectForm({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
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
    <form action={action} noValidate className="w-full rounded-2xl border border-zk-border bg-zk-surface px-5 py-4">
      <label htmlFor="new-project-name" className="block text-sm font-medium text-zk-text">
        Project name
      </label>
      <p className="mt-0.5 text-xs text-zk-muted">A product or area of the organisation, such as a web app or iOS app.</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="new-project-name"
          name="name"
          placeholder="Web app"
          required
          maxLength={PROJECT_NAME_MAX + 20}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "new-project-error" : undefined}
          className="sm:max-w-sm"
        />
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
