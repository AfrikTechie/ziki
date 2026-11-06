"use client";

import { useActionState } from "react";
import { createProjectAction, type ProjectActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROJECT_NAME_MAX } from "./validation";
import { ProjectRewardRulesSection } from "@/components/project-reward-rules-section";
import type { ProjectRewardConfig } from "@/lib/points/project-rewards";

export function CreateProjectForm({
  defaults = null,
}: {
  defaults?: ProjectRewardConfig | null;
}) {
  const [result, action, pending] = useActionState<
    ProjectActionResult | undefined,
    FormData
  >(createProjectAction, undefined);
  const error = result?.error;

  return (
    <form action={action} className="mt-4 space-y-4" noValidate>
      <div>
        <label
          htmlFor="project-name"
          className="block text-sm font-medium text-zk-text"
        >
          Project name
        </label>
        <p className="mt-0.5 text-xs text-zk-muted">
          A product or area inside your organisation, such as a web app or iOS app.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            id="project-name"
            name="name"
            placeholder="Web app"
            required
            maxLength={PROJECT_NAME_MAX + 20}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "project-name-error" : undefined}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </Button>
        </div>
      </div>

      <ProjectRewardRulesSection disabled={pending} defaults={defaults} />

      {error ? (
        <p id="project-name-error" role="alert" className="text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}
