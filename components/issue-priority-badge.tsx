import { ISSUE_PRIORITY_BADGE_CLASSES, ISSUE_PRIORITY_LABELS, normalizeIssuePriority, type IssuePriority } from "@/lib/issue-priority";

export function IssuePriorityBadge({ priority }: { priority: unknown }) {
  const p = normalizeIssuePriority(priority) as IssuePriority;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ISSUE_PRIORITY_BADGE_CLASSES[p]}`}
      aria-label={`Priority: ${ISSUE_PRIORITY_LABELS[p]}`}
    >
      {ISSUE_PRIORITY_LABELS[p]}
    </span>
  );
}
