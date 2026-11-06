"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectJoinModal } from "@/components/project-join-modal";
import { projectPath, projectRef } from "@/lib/project-paths";

export type DiscoverableProject = {
  id: string;
  slug: string;
  name: string;
  goal: string | null;
  siteUrl: string | null;
  repoUrl: string | null;
  isOpenForContributors: boolean;
  contributorGuidelines: string | null;
  organisation: {
    id: string;
    name: string;
    slug: string;
  };
  _count: {
    bugs: number;
    ideas: number;
  };
  userStatus: "member" | "pending" | "rejected" | "none" | "guest";
};

export function DiscoverProjectCard({ project }: { project: DiscoverableProject }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(project.userStatus);

  return (
    <>
      <article className="flex flex-col justify-between rounded-[20px] border border-zk-border bg-zk-surface p-5 transition hover:border-zk-border-hover sm:p-6">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-zk-muted">
                {project.organisation.name}
              </span>
              <h3 className="text-lg font-bold text-zk-text">
                <Link href={projectPath(projectRef(project.organisation.slug, project.slug))} className="hover:text-zk-accent hover:underline">
                  {project.name}
                </Link>
              </h3>
            </div>
            {project.isOpenForContributors ? (
              <Badge className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[11px] font-semibold text-emerald-400">
                Open for Contributors
              </Badge>
            ) : (
              <Badge className="shrink-0 rounded-full border border-zk-border bg-zk-chip text-[11px] font-medium text-zk-text2">
                Not open for now
              </Badge>
            )}
          </div>

          <p className="line-clamp-2 text-sm text-zk-text2">
            {project.goal || "No project description provided."}
          </p>

          <div className="flex flex-wrap items-center gap-4 text-xs text-zk-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              {project._count.bugs} open issues
            </span>
            <span className="flex items-center gap-1.5">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-zk-muted"
                aria-hidden="true"
              >
                <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
                <path d="M9 18h6" />
                <path d="M10 22h4" />
              </svg>
              {project._count.ideas} ideas
            </span>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-zk-divider pt-4">
          <div className="flex items-center gap-2 text-xs text-zk-muted">
            {project.repoUrl ? (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-zk-text hover:underline"
              >
                Code ↗
              </a>
            ) : null}
            {project.siteUrl ? (
              <a
                href={project.siteUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-zk-text hover:underline"
              >
                Website ↗
              </a>
            ) : null}
          </div>

          <div>
            {currentStatus === "guest" ? (
              project.isOpenForContributors ? (
                <Link href={`/login?callbackUrl=${encodeURIComponent("/discover")}`}>
                  <Button
                    variant="primary"
                    className="text-xs font-semibold"
                  >
                    Sign in to Join
                  </Button>
                </Link>
              ) : (
                <Button
                  variant="secondary"
                  disabled
                  className="text-xs font-medium opacity-60"
                >
                  Not open for now
                </Button>
              )
            ) : currentStatus === "member" ? (
              <Link href={projectPath(projectRef(project.organisation.slug, project.slug))}>
                <Button variant="secondary" className="text-xs font-medium">
                  Open Project →
                </Button>
              </Link>
            ) : currentStatus === "pending" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zk-border bg-zk-chip/50 px-3.5 py-1.5 text-xs font-medium text-zk-muted">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Request Pending
              </span>
            ) : project.isOpenForContributors ? (
              <Button
                variant="primary"
                onClick={() => setModalOpen(true)}
                className="text-xs font-bold"
              >
                {currentStatus === "rejected" ? "Re-apply to Join" : "Request to Join"}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled
                className="text-xs font-medium opacity-60"
              >
                Not open for now
              </Button>
            )}
          </div>
        </div>
      </article>

      <ProjectJoinModal
        project={project}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => setCurrentStatus("pending")}
      />
    </>
  );
}
