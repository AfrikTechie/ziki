"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { orgPath, projectRef } from "@/lib/project-paths";

/** The organization admin area's sections, one route each, under `/<slug>/org` (#project-urls). */
export const ORG_TABS = [
  { section: "", label: "Overview" },
  { section: "members", label: "Members" },
  { section: "invites", label: "Invites" },
  { section: "projects", label: "Projects" },
  { section: "types", label: "Issue types" },
  { section: "milestones", label: "Milestones" },
  { section: "settings", label: "Settings" },
] as const;

function isActive(pathname: string, href: string, overview: boolean): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (overview) return path === href;
  return path === href || path.startsWith(`${href}/`);
}

/**
 * The segmented tab bar under the organization's name. On a phone it scrolls
 * sideways inside itself, so the page never does.
 */
export function OrgTabs() {
  const pathname = usePathname() ?? "";
  const params = useParams<{ org: string; project: string }>();
  const slug = projectRef(params.org, params.project);
  return (
    <nav aria-label="Organization sections" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex w-max gap-0.5 rounded-full bg-zk-seg p-1">
        {ORG_TABS.map((tab) => {
          const href = orgPath(slug, tab.section);
          const on = isActive(pathname, href, tab.section === "");
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue ${
                  on
                    ? "bg-zk-surface font-bold text-zk-text shadow-[0_1px_3px_rgba(21,18,31,0.12)]"
                    : "font-medium text-zk-text2 hover:text-zk-text"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
