import { z } from "zod";
import { issuesPath, statusFromSegment, type ProjectRef } from "@/lib/project-paths";

export const MAX_SAVED_ISSUE_VIEWS = 20;
export type SavedIssueView = { id: string; name: string; status: string; query: string };

const queryKeys = ["q", "sort", "mine", "tags", "area", "milestone", "duplicates", "project", "mywork", "track", "stage", "confirm", "resolved", "deleted"] as const;

/** Keep only the board's filters. Pagination and arbitrary URLs are never saved. */
export function savedIssueQuery(raw: string): string {
  const source = new URLSearchParams(raw);
  const query = new URLSearchParams();
  for (const key of queryKeys) {
    const value = source.get(key);
    if (value) query.set(key, value);
  }
  return query.toString();
}

export const savedIssueViewSchema = z.object({
  name: z.string().trim().min(1, "Give this view a name.").max(60, "Use at most 60 characters."),
  status: z.string().max(40).refine((value) => {
    const segment = issuesPath("org/project" as ProjectRef, value).split("/").pop()!;
    return statusFromSegment(segment) === value;
  }, "Choose an issue list."),
  query: z.string().max(4000, "These filters are too long to save.").transform(savedIssueQuery),
}).strict();

export function savedIssueViewHref(ref: ProjectRef, view: Pick<SavedIssueView, "status" | "query">): string {
  return issuesPath(ref, view.status, savedIssueQuery(view.query));
}
