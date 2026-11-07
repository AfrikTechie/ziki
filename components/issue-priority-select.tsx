"use client";

import { useState, useTransition } from "react";
import { setIssuePriorityAction } from "@/app/actions/issues";
import { ISSUE_PRIORITIES, ISSUE_PRIORITY_LABELS, normalizeIssuePriority } from "@/lib/issue-priority";
import { IssuePriorityBadge } from "@/components/issue-priority-badge";
import { useToast } from "@/components/ui/toast";

export function IssuePrioritySelect({ bugId, priority }: { bugId: string; priority: unknown }) {
  const [current, setCurrent] = useState(normalizeIssuePriority(priority));
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-zk-text-muted">Priority</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = current;
          setCurrent(normalizeIssuePriority(next));
          startTransition(async () => {
            const result = await setIssuePriorityAction(bugId, next);
            if (result.error || !result.ok) {
              setCurrent(prev);
              toast(result.error ?? "Failed to update priority", "error");
            } else {
              toast("Priority updated.");
            }
          });
        }}
        className="rounded-md border border-zk-border bg-zk-surface px-2 py-1 text-sm text-zk-text"
      >
        {ISSUE_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {ISSUE_PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      <IssuePriorityBadge priority={current} />
    </label>
  );
}
