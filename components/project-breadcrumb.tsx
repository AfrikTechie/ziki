"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ideasPath, orgHomePath, projectPath, projectRef, type ProjectRef } from "@/lib/project-paths";

/** The organisation's slug, and the project (none on the organisation's own page). */
export type BreadcrumbProject = { orgSlug: string; slug?: string; name?: string };

/** Each issue list's stage (the tabs across the top) and, when the stage has several, its step. */
const ISSUE_LISTS: Record<string, [string, string?]> = {
  "your-work": ["Your Work"],
  open: ["In Progress", "Open"],
  "in-progress": ["In Progress", "In progress"],
  closed: ["In Progress", "Closed"],
  "possibly-delivered": ["In Progress", "Possibly delivered"],
  "your-call": ["In Progress", "Your call"],
  done: ["Delivered", "Done"],
  merge: ["Delivered", "Merge"],
  error: ["Delivered", "Error"],
  live: ["Live"],
  all: ["All issues"],
  rejected: ["All issues", "Rejected"],
  duplicates: ["All issues", "Duplicates"],
  finished: ["All issues", "Closed"],
  new: ["Report an issue"],
};
const IDEA_LISTS: Record<string, string> = { rejected: "Rejected", drafts: "Drafts" };

/** What the page under the project is, from its path: [Ideas], [In Progress, Closed], [Issue #12], … */
function sectionOf(pathname: string, ref: ProjectRef): string[] {
  const rest = pathname.slice(projectPath(ref).length).replace(/^\/+|\/+$/g, "");
  const [first, second] = rest.split("/");
  if (!first) return [];
  if (/^[0-9]+$/.test(first)) return [`Issue #${first}`];
  if (first === "ideas") {
    if (second && /^[0-9]+$/.test(second)) return ["Ideas", `Idea #${second}`];
    return second && IDEA_LISTS[second] ? ["Ideas", IDEA_LISTS[second]] : ["Ideas"];
  }
  if (first === "issues") return (ISSUE_LISTS[second ?? "all"] ?? ["Issues"]).filter((part): part is string => Boolean(part));
  const named: Record<string, string> = { notes: "Notes", org: "Organisation", workstream: "Workstream" };
  return named[first] ? [named[first]] : [];
}

const crumb = "rounded-md px-1.5 py-0.5 hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent";

/**
 * Where you are (#no-platforms): All Projects (the organisation's projects
 * page, `/<org>`), the project (its issue list) and the page in it. On the
 * projects page itself, All Projects is all there is.
 */
export function ProjectBreadcrumb({ project }: { project: BreadcrumbProject }) {
  const pathname = usePathname() ?? "";
  const projectsHref = orgHomePath(project.orgSlug);
  const ref = project.slug ? projectRef(project.orgSlug, project.slug) : null;
  const onProjects = !ref;
  const section = ref ? sectionOf(pathname, ref) : [];
  return (
    <nav aria-label="Breadcrumb" className="mx-auto mb-3 flex w-full max-w-6xl items-center px-0.5 text-[13px] text-zk-text2 max-sm:mb-1">
      <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
        {/* Every project of the organisation, with its health. */}
        <li className="min-w-0">
          <Link href={projectsHref} aria-current={onProjects ? "page" : undefined} className={`${crumb} block truncate ${onProjects ? "font-bold text-zk-text" : "font-medium text-zk-text2"}`}>
            All Projects
          </Link>
        </li>
        {!ref ? null : (
          <>
            <li aria-hidden="true" className="text-zk-muted">/</li>
            <li className="min-w-0">
              <Link href={ideasPath(ref)} className={`${crumb} block truncate font-bold text-zk-text`}>{project.name}</Link>
            </li>
            {section.map((part, index) => (
              <Fragment key={part}>
                <li aria-hidden="true" className="text-zk-muted">/</li>
                <li aria-current={index === section.length - 1 ? "page" : undefined} className={`truncate px-1.5 ${index === section.length - 1 ? "" : "font-medium"}`}>{part}</li>
              </Fragment>
            ))}
          </>
        )}
      </ol>
    </nav>
  );
}
