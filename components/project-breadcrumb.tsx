"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { overviewPath } from "@/lib/project-paths";

export type BreadcrumbProject = { slug: string; name: string };

/** What the page under the project is, from its path: Overview, Ideas, Issue #12, … */
function sectionOf(pathname: string, slug: string): string | null {
  const rest = pathname.slice(`/${encodeURIComponent(slug)}`.length).replace(/^\/+|\/+$/g, "");
  const [first, second] = rest.split("/");
  if (!first || first === "overview") return null;
  if (/^[0-9]+$/.test(first)) return `Issue #${first}`;
  if (first === "ideas") return second && /^[0-9]+$/.test(second) ? `Idea #${second}` : "Ideas";
  if (first === "issues") return second === "new" ? "Report an issue" : "Issues";
  const named: Record<string, string> = { notes: "Notes", org: "Organisation", workstream: "Workstream" };
  return named[first] ?? null;
}

const crumb = "rounded-md px-1.5 py-0.5 hover:bg-zk-chip hover:text-zk-text focus-visible:outline-2 focus-visible:outline-zk-accent";

/**
 * Where you are (#no-platforms): the organisation, the project (with every
 * other project of the organisation one click away) and the page in it.
 */
export function ProjectBreadcrumb({ organisation, project, projects }: {
  organisation: string;
  project: BreadcrumbProject;
  projects: BreadcrumbProject[];
}) {
  const pathname = usePathname() ?? "";
  const section = sectionOf(pathname, project.slug);
  const others = projects.filter((p) => p.slug !== project.slug);
  return (
    <nav aria-label="Breadcrumb" className="mx-auto mb-3 flex w-full max-w-6xl items-center px-0.5 text-[13px] text-zk-text2">
      <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
        <li className="truncate px-1.5 font-medium text-zk-muted">{organisation}</li>
        <li aria-hidden="true" className="text-zk-muted">/</li>
        <li className="relative">
          {others.length ? (
            <details className="group relative">
              <summary className={`${crumb} flex cursor-pointer list-none items-center gap-1 font-bold text-zk-text [&::-webkit-details-marker]:hidden`}>
                {project.name}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition group-open:rotate-180"><path d="m6 9 6 6 6-6" /></svg>
                <span className="sr-only">: switch project</span>
              </summary>
              <ul className="absolute left-0 top-full z-30 mt-1 max-h-80 min-w-48 overflow-auto rounded-xl border border-zk-border bg-zk-surface p-1 shadow-lg">
                {projects.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={overviewPath(p.slug)}
                      aria-current={p.slug === project.slug ? "page" : undefined}
                      className={`block truncate rounded-lg px-3 py-1.5 text-sm hover:bg-zk-chip ${p.slug === project.slug ? "font-bold text-zk-text" : "text-zk-text2"}`}
                    >
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <Link href={overviewPath(project.slug)} className={`${crumb} font-bold text-zk-text`}>{project.name}</Link>
          )}
        </li>
        {section ? (
          <>
            <li aria-hidden="true" className="text-zk-muted">/</li>
            <li aria-current="page" className="truncate px-1.5">{section}</li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}
