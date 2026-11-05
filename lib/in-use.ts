import { issuesPath, type ProjectRef } from "@/lib/project-paths";

/**
 * Wording for "this issue type can't be deleted because issues use it"
 * (#314).
 */

const issues = (n: number) => `${n} ${n === 1 ? "issue" : "issues"}`;

export type InUseText = {
  /** The sentence explaining why deletion was refused. */
  reason: string;
  /** Label for the link to the live issues, or null when there are none. */
  liveLink: string | null;
  /** Label for the link to the deleted ones, or null when there are none. */
  deletedLink: string | null;
};

/**
 * `total` is what blocks deletion: soft-deleted issues still hold the
 * foreign key. The list hides deleted issues, so a link labelled with the
 * total would open fewer rows than it promised — hence the split.
 */
export function inUseText({
  name,
  total,
  deleted,
}: {
  name: string;
  total: number;
  deleted: number;
}): InUseText {
  const live = Math.max(0, total - deleted);
  return {
    reason: `The issue type “${name}” can't be deleted because ${issues(total)} ${total === 1 ? "uses" : "use"} it.`,
    liveLink: live > 0 ? `View the ${issues(live)}` : null,
    deletedLink: deleted > 0 ? `${deleted} deleted ${deleted === 1 ? "issue" : "issues"}` : null,
  };
}

/** Where those issues are, on the existing filtered list (types filter through the tag filter, by name). */
export function inUseHrefs(slug: ProjectRef, value: string): { live: string; deleted: string } {
  const q = `tags=${encodeURIComponent(value)}`;
  return { live: issuesPath(slug, "all", q), deleted: issuesPath(slug, "all", `deleted=true&${q}`) };
}
