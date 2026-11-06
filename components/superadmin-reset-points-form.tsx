"use client";

import { useFormStatus } from "react-dom";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Resetting…" : "Reset all agent $"}
    </button>
  );
}

/** Asks for confirmation before the super admin reverses an organisation's agent points. */
export function ResetAgentPointsForm({
  action,
  slug,
  name,
  disabled,
}: {
  action: (formData: FormData) => Promise<void>;
  slug: string;
  name: string;
  disabled: boolean;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Reverse every point agents earned in ${name}? This cannot be undone from here.`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <SubmitButton disabled={disabled} />
    </form>
  );
}
