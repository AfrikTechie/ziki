import { newIssuePath, type ProjectRef } from "@/lib/project-paths";

/**
 * The in-app page a quick report was opened from (#report-modal), passed as
 * `?from=` by the links that open the report modal. Only a same-site path is
 * kept: no scheme, no `//host`, no whitespace or control characters, no
 * report page itself, and a sensible length. Anything else is dropped.
 */
export function safeReportedFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.length > 300) return null;
  if (/[\s\u0000-\u001f\u007f\\]/.test(path)) return null;
  if (/^\/[^/]+\/[^/]+\/issues\/new(?:[/?#]|$)/.test(path)) return null;
  return path;
}

/** The line appended to a quick report's description when the page is kept. */
export function reportedFromLine(path: string): string {
  return `Reported from: ${path}`;
}

/** The report-issue link for a project's page, carrying that page as `?from=` (#project-urls). */
export function newIssueHref(ref: ProjectRef, from?: string | null): string {
  const safe = safeReportedFrom(from);
  const path = newIssuePath(ref);
  return safe ? `${path}?from=${encodeURIComponent(safe)}` : path;
}
