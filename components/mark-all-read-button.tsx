"use client";

import { useState, useTransition } from "react";
import { markAllNotificationsReadAction } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import type { WorkTrack } from "@prisma/client";

export function MarkAllReadButton({ allWorkspaces = false, track = "all" }: { allWorkspaces?: boolean; track?: WorkTrack | "all" }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markAllRead() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await markAllNotificationsReadAction(allWorkspaces, track);
        if (!result.ok) setError("Could not mark notifications as read. Please try again.");
      } catch {
        setError("Could not mark notifications as read. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={markAllRead}
        className="h-10 rounded-full border border-zk-border bg-zk-surface px-4 font-semibold text-zk-text hover:bg-zk-chip"
      >
        {pending ? "Marking…" : "Mark all as read"}
      </Button>
      {error ? <p role="alert" className="text-sm text-zk-bad-fg">{error}</p> : null}
    </div>
  );
}
