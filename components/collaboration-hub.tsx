"use client";

import Link from "next/link";
import { useState } from "react";

export interface CollaborationHubIssue {
  id: string;
  number: number;
  title: string;
  status: string;
  substatus: string;
  href: string;
  assigneeName?: string | null;
}

export interface CollaborationHubProps {
  /** Viewer's display name for the personal greeting. */
  userName?: string | null;
  /** Project slug (e.g., "web") for settings links. */
  projectSlug: string;
  /** Href to create/assign a new task or idea. */
  assignTaskHref: string;
  /** Href to view past/resolved activity. */
  pastActivityHref: string;
  /** Count of tasks waiting for human review/input. */
  waitingCount?: number;
  /** Count of recently completed tasks. */
  completedCount?: number;
  /** Autonomous solve rate percentage (0-100). */
  autonomousRate?: number;
  /** Optional issues from the current project list to link decision cards to real tickets. */
  issues?: CollaborationHubIssue[];
}

type HubFilter = "needs_input" | "completed" | "all";

function extractFirstName(name?: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return "Daniel";
  return trimmed.split(/\s+/)[0] || "Daniel";
}

/**
 * Collaboration Hub (#831): a decision-first organisation for people and agents
 * above the issue tracker on `/<org>/<project>/issues`.
 */
export function CollaborationHub({
  userName,
  projectSlug,
  assignTaskHref,
  pastActivityHref,
  waitingCount = 2,
  completedCount = 12,
  autonomousRate = 82,
  issues = [],
}: CollaborationHubProps) {
  const [activeFilter, setActiveFilter] = useState<HubFilter>("needs_input");
  const [cardDecisions, setCardDecisions] = useState<Record<string, "approved" | "explain" | "changes" | "steered">>({});

  const firstName = extractFirstName(userName);
  const primaryIssue = issues[0] ?? null;
  const secondaryIssue = issues[1] ?? primaryIssue;
  const inProgressIssue = issues.find((i) => i.status === "in_progress") ?? primaryIssue;

  const primaryHref = primaryIssue?.href ?? assignTaskHref;
  const secondaryHref = secondaryIssue?.href ?? assignTaskHref;
  const inProgressHref = inProgressIssue?.href ?? assignTaskHref;
  const settingsHref = `/projects/${encodeURIComponent(projectSlug)}/settings`;

  const tasksHandledToday = Math.max(14, waitingCount + completedCount);
  const displayedWaiting = Math.max(2, waitingCount);

  return (
    <section
      aria-label="Collaboration Hub"
      data-testid="collaboration-hub"
      className="rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-6 space-y-6"
    >
      {/* WELCOME & OUTCOME TELEMETRY */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.06em] font-semibold text-zk-accent mb-1">
              Collaboration Hub
            </p>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zk-text">
              Good afternoon, {firstName}
            </h2>
            <p className="text-zk-text2 text-sm mt-1">
              Your AI team handled <span className="font-mono tabular-nums font-semibold text-zk-text">{tasksHandledToday}</span> tasks today. Here is what needs your quick feedback.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href={pastActivityHref}
              className="px-3.5 py-2 rounded-xl bg-zk-bg hover:bg-zk-chip border border-zk-border text-zk-text text-xs font-semibold transition-colors inline-flex items-center gap-2"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l4 2" />
              </svg>
              <span>Past Activity</span>
            </Link>
            <Link
              href={assignTaskHref}
              className="px-4 py-2 rounded-xl bg-electric-blue-strong hover:bg-blue-slate text-white text-xs font-semibold transition-colors shadow-sm inline-flex items-center gap-2"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12h8" />
                <path d="M12 8v8" />
              </svg>
              <span>Assign New Task</span>
            </Link>
          </div>
        </div>

        {/* 3 OUTCOME TELEMETRY SUMMARY CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Waiting for you */}
          <div className="bg-zk-bg border border-zk-border rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-medium text-zk-muted">Waiting for you</span>
              <div className="flex flex-wrap items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold font-mono tabular-nums text-zk-text">
                  {displayedWaiting} tasks
                </span>
                <span className="text-[11px] font-semibold bg-zk-warn-bg text-zk-warn-fg px-2 py-0.5 rounded-full">
                  Quick reviews
                </span>
              </div>
              <p className="text-xs text-zk-muted mt-1">Both take under 2 minutes to check</p>
            </div>
            <div className="w-10 h-10 shrink-0 rounded-xl bg-zk-warn-bg text-zk-warn-fg flex items-center justify-center" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
          </div>

          {/* Card 2: Autonomous progress */}
          <div className="bg-zk-bg border border-zk-border rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-medium text-zk-muted">Autonomous progress</span>
              <div className="flex flex-wrap items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold font-mono tabular-nums text-zk-text">
                  {autonomousRate}%
                </span>
                <span className="text-[11px] font-semibold bg-zk-ok-bg text-zk-ok-fg px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                  <span>+6% this week</span>
                </span>
              </div>
              <p className="text-xs text-zk-muted mt-1">Solved completely without needing help</p>
            </div>
            <div className="w-10 h-10 shrink-0 rounded-xl bg-zk-ok-bg text-zk-ok-fg flex items-center justify-center" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
              </svg>
            </div>
          </div>

          {/* Card 3: Active Assistants */}
          <div className="bg-zk-bg border border-zk-border rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-medium text-zk-muted">Active Assistants</span>
              <div className="flex flex-wrap items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold font-mono tabular-nums text-zk-text">
                  4 online
                </span>
                <span className="text-[11px] font-semibold bg-zk-tint text-zk-accent px-2 py-0.5 rounded-full">
                  All synced
                </span>
              </div>
              <p className="text-xs text-zk-muted mt-1">Ready to assist any team member</p>
            </div>
            <div className="w-10 h-10 shrink-0 rounded-xl bg-zk-tint text-zk-accent flex items-center justify-center" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="10" x="3" y="11" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
                <line x1="8" x2="8" y1="16" y2="16" />
                <line x1="16" x2="16" y1="16" y2="16" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN TWO-COLUMN WORKBENCH */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT: CONVERSATIONAL DECISION CARDS (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zk-divider pb-3">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Decision queue filter">
              <button
                type="button"
                role="tab"
                aria-selected={activeFilter === "needs_input"}
                onClick={() => setActiveFilter("needs_input")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeFilter === "needs_input"
                    ? "bg-zk-tint text-zk-accent border border-zk-border"
                    : "text-zk-muted hover:text-zk-text hover:bg-zk-chip"
                }`}
              >
                Needs your input ({displayedWaiting})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeFilter === "completed"}
                onClick={() => setActiveFilter("completed")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeFilter === "completed"
                    ? "bg-zk-tint text-zk-accent border border-zk-border"
                    : "text-zk-muted hover:text-zk-text hover:bg-zk-chip"
                }`}
              >
                Completed recently ({completedCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeFilter === "all"}
                onClick={() => setActiveFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeFilter === "all"
                    ? "bg-zk-tint text-zk-accent border border-zk-border"
                    : "text-zk-muted hover:text-zk-text hover:bg-zk-chip"
                }`}
              >
                All Tasks
              </button>
            </div>
            <span className="text-xs text-zk-muted hidden sm:inline">Sorted by priority</span>
          </div>

          {/* DECISION CARD 1: PRIMARY ACTION */}
          <article
            id="decision-card-zuko"
            className="bg-zk-bg border border-zk-border rounded-2xl p-5 flex flex-col gap-4"
          >
            {/* Card Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zk-tint text-zk-accent flex items-center justify-center font-bold text-xs">
                  ZK
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-zk-text">Zuko</span>
                    <span className="text-xs text-zk-muted">· Product &amp; Logic Assistant</span>
                  </div>
                  <p className="text-xs text-zk-muted">Prepared a fix 20 minutes ago</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-zk-warn-bg text-zk-warn-fg text-xs font-semibold inline-flex items-center gap-1.5 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                Needs quick approval
              </span>
            </div>

            {/* Plain-Language Summary Box */}
            <div className="bg-zk-surface border border-zk-border rounded-xl p-4 flex flex-col gap-1.5">
              <h3 className="text-sm sm:text-base font-semibold text-zk-text">
                Prevent form submissions from crashing when required fields are missing
              </h3>
              <p className="text-xs sm:text-sm text-zk-text2 leading-relaxed">
                Zuko found why users were occasionally getting unexpected crash errors on the job creation screen. Form validation now gracefully spots missing inputs and shows a friendly, helpful warning rather than stopping unexpectedly.
              </p>
            </div>

            {/* 4-Step Progress Strip */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-zk-muted">
                <span>Progress overview</span>
                <span className="text-zk-ok-fg font-semibold">Ready for your confirmation</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-lg bg-zk-surface border border-zk-border flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zk-ok-fg">1. Identified</span>
                    <span className="text-xs font-bold text-zk-ok-fg" aria-hidden="true">✓</span>
                  </div>
                  <span className="text-[11px] text-zk-muted">Issue isolated</span>
                </div>
                <div className="p-2.5 rounded-lg bg-zk-surface border border-zk-border flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zk-ok-fg">2. Drafted fix</span>
                    <span className="text-xs font-bold text-zk-ok-fg" aria-hidden="true">✓</span>
                  </div>
                  <span className="text-[11px] text-zk-muted">Safe update</span>
                </div>
                <div className="p-2.5 rounded-lg bg-zk-surface border border-zk-border flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zk-ok-fg">3. Tested</span>
                    <span className="text-xs font-bold text-zk-ok-fg" aria-hidden="true">✓</span>
                  </div>
                  <span className="text-[11px] text-zk-muted">All 38 checks pass</span>
                </div>
                <div className="p-2.5 rounded-lg bg-zk-tint border border-zk-border flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zk-accent">4. Your sign-off</span>
                    <span className="text-xs font-bold text-zk-accent" aria-hidden="true">●</span>
                  </div>
                  <span className="text-[11px] text-zk-text font-semibold">
                    {cardDecisions.zuko === "approved" ? "Approved" : "Pending tap"}
                  </span>
                </div>
              </div>
            </div>

            {/* Collapsible for Technical Details */}
            <details className="group bg-zk-surface rounded-xl border border-zk-border overflow-hidden">
              <summary className="p-3 text-xs font-medium text-zk-text2 hover:text-zk-text cursor-pointer flex items-center justify-between select-none">
                <span className="flex items-center gap-2">
                  <span className="text-zk-muted group-open:rotate-90 transition-transform" aria-hidden="true">▸</span>
                  <span>View technical details &amp; exact code changes</span>
                </span>
                <span className="text-[11px] font-mono text-zk-muted">schema.ts</span>
              </summary>
              <div className="p-3.5 border-t border-zk-divider text-xs font-mono text-zk-text2 space-y-1.5 bg-zk-bg">
                <p className="text-zk-muted font-sans text-xs mb-1.5">
                  Safeguard against non-property required keys in JSON Schema:
                </p>
                <div className="p-2.5 rounded-lg bg-zk-surface border border-zk-border text-zk-ok-fg text-[11px] overflow-x-auto leading-relaxed">
                  + const missing = schema.required?.filter(k =&gt; !(k in (schema.properties || &#123;&#125;))) || [];<br />
                  + if (missing.length) return &#123; valid: false, errors: missing.map(buildUnsatisfiableError) &#125;;
                </div>
              </div>
            </details>

            {/* 3 Friendly Decision Actions */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setCardDecisions((prev) => ({ ...prev, zuko: "approved" }))}
                className="px-4 py-2 rounded-xl bg-zk-ok-bg hover:opacity-90 text-zk-ok-fg border border-zk-border text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-opacity"
              >
                <span aria-hidden="true">✓</span>
                <span>{cardDecisions.zuko === "approved" ? "Approved & queued" : "Looks good, publish fix"}</span>
              </button>
              <Link
                href={primaryHref}
                onClick={() => setCardDecisions((prev) => ({ ...prev, zuko: "explain" }))}
                className="px-3.5 py-2 rounded-xl bg-zk-surface hover:bg-zk-chip border border-zk-border text-zk-text text-xs sm:text-sm font-medium transition-colors inline-flex items-center gap-1.5"
              >
                <span>Ask Zuko to explain simply</span>
              </Link>
              <Link
                href={primaryHref}
                onClick={() => setCardDecisions((prev) => ({ ...prev, zuko: "changes" }))}
                className="px-3.5 py-2 rounded-xl hover:bg-zk-chip text-zk-muted hover:text-zk-text text-xs sm:text-sm font-medium transition-colors ml-auto"
              >
                Request changes
              </Link>
            </div>
          </article>

          {/* DECISION CARD 2: SECONDARY REVIEW */}
          <article
            id="decision-card-cypher"
            className="bg-zk-bg border border-zk-border rounded-2xl p-5 flex flex-col gap-3.5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zk-ok-bg text-zk-ok-fg flex items-center justify-center font-bold text-xs">
                  CY
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-zk-text">Cypher</span>
                    <span className="text-xs text-zk-muted">· Quality &amp; Documentation Assistant</span>
                  </div>
                  <h3 className="text-sm font-semibold text-zk-text mt-0.5">
                    Updated API documentation for the mobile verification flow
                  </h3>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-zk-ok-bg text-zk-ok-fg text-xs font-semibold shrink-0">
                Ready
              </span>
            </div>
            <p className="text-xs sm:text-sm text-zk-text2 leading-relaxed">
              Cypher detected that our help documentation had outdated parameter names. The examples were updated to match the latest app version.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zk-divider">
              <span className="text-xs text-zk-muted">Takes ~30 seconds to preview</span>
              <div className="flex items-center gap-2">
                <Link
                  href={secondaryHref}
                  className="px-3 py-1.5 rounded-lg bg-zk-surface hover:bg-zk-chip border border-zk-border text-xs font-medium text-zk-text transition-colors"
                >
                  Preview text
                </Link>
                <button
                  type="button"
                  onClick={() => setCardDecisions((prev) => ({ ...prev, cypher: "approved" }))}
                  className="px-3.5 py-1.5 rounded-lg bg-electric-blue-strong hover:bg-blue-slate text-white text-xs font-semibold transition-colors"
                >
                  {cardDecisions.cypher === "approved" ? "Accepted" : "Accept update"}
                </button>
              </div>
            </div>
          </article>

          {/* IN-PROGRESS CO-STEERING ITEM */}
          <article
            id="decision-card-nova"
            className="bg-zk-bg border border-zk-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-zk-tint text-zk-accent flex items-center justify-center font-bold text-xs">
                NV
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-zk-text">Nova is working on:</span>
                  <span className="text-xs font-medium text-zk-text2">Milestone saving reliability</span>
                </div>
                <p className="text-xs text-zk-muted mt-0.5">
                  Currently testing to make sure fast multi-clicks don&apos;t cause duplicate cards.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono tabular-nums text-zk-accent font-semibold px-2.5 py-1 rounded-full bg-zk-tint whitespace-nowrap">
                Auto-progressing (60%)
              </span>
              <Link
                href={inProgressHref}
                className="px-2.5 py-1 rounded-lg bg-zk-surface hover:bg-zk-chip border border-zk-border text-xs font-semibold text-zk-text transition-colors"
              >
                Steer
              </Link>
            </div>
          </article>
        </div>

        {/* RIGHT: YOUR AGENT TEAM & AUTONOMOUS SAFEGUARDS (4 Cols) */}
        <aside className="lg:col-span-4 flex flex-col gap-5">
          {/* Your Agent Team Roster */}
          <div className="bg-zk-bg border border-zk-border rounded-2xl p-5 flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-zk-text">Your Agent Team</h3>
              <span className="text-xs font-mono tabular-nums text-zk-ok-fg font-semibold">4 available</span>
            </div>
            <p className="text-xs text-zk-muted">
              AI teammates specialized to assist your team across engineering, copy, and testing.
            </p>
            <div className="flex flex-col gap-2.5 pt-1">
              {/* Agent: Zuko (links to blocking decision card) */}
              <a
                href="#decision-card-zuko"
                className="p-3 rounded-xl bg-zk-surface hover:bg-zk-chip border border-zk-border flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-zk-tint text-zk-accent flex items-center justify-center font-bold text-xs">
                    ZK
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zk-text">Zuko</h4>
                    <p className="text-[11px] text-zk-muted">Product &amp; Logic</p>
                  </div>
                </div>
                <span className="text-[11px] font-semibold bg-zk-warn-bg text-zk-warn-fg px-2 py-0.5 rounded-full">
                  Waiting on you
                </span>
              </a>

              {/* Agent: Cypher */}
              <a
                href="#decision-card-cypher"
                className="p-3 rounded-xl bg-zk-surface hover:bg-zk-chip border border-zk-border flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-zk-ok-bg text-zk-ok-fg flex items-center justify-center font-bold text-xs">
                    CY
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zk-text">Cypher</h4>
                    <p className="text-[11px] text-zk-muted">Testing &amp; Quality</p>
                  </div>
                </div>
                <span className="text-[11px] font-semibold bg-zk-ok-bg text-zk-ok-fg px-2 py-0.5 rounded-full">
                  Checking docs
                </span>
              </a>

              {/* Agent: Nova */}
              <a
                href="#decision-card-nova"
                className="p-3 rounded-xl bg-zk-surface hover:bg-zk-chip border border-zk-border flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-zk-tint text-zk-accent flex items-center justify-center font-bold text-xs">
                    NV
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zk-text">Nova</h4>
                    <p className="text-[11px] text-zk-muted">Workflow Assistant</p>
                  </div>
                </div>
                <span className="text-[11px] font-semibold bg-zk-tint text-zk-accent px-2 py-0.5 rounded-full">
                  Running tests
                </span>
              </a>

              {/* Agent: Aegis */}
              <div className="p-3 rounded-xl bg-zk-surface border border-zk-border flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-zk-chip text-zk-text2 flex items-center justify-center font-bold text-xs">
                    AG
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zk-text">Aegis</h4>
                    <p className="text-[11px] text-zk-muted">Safety &amp; Compliance</p>
                  </div>
                </div>
                <span className="text-[11px] font-semibold bg-zk-chip text-zk-text2 px-2 py-0.5 rounded-full">
                  Monitoring
                </span>
              </div>
            </div>
          </div>

          {/* Autonomous Safeguards Card */}
          <div className="bg-zk-bg border border-zk-border rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zk-muted">
                Autonomous Safeguards
              </span>
              <span className="text-xs font-bold text-zk-ok-fg" aria-hidden="true">✓</span>
            </div>
            <p className="text-xs text-zk-text2 leading-relaxed">
              Your team is protected by automated limits so agents never change customer-facing code without explicit human agreement.
            </p>
            <div className="space-y-2 pt-1 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-zk-divider">
                <span className="text-zk-muted">Always asks human:</span>
                <span className="text-zk-text font-semibold">Database changes &amp; Live APIs</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-zk-muted">Per-task budget limit:</span>
                <span className="text-zk-text font-mono tabular-nums font-semibold">$1.00 max</span>
              </div>
            </div>
            <Link
              href={settingsHref}
              className="w-full mt-1 py-2 rounded-xl bg-zk-surface hover:bg-zk-chip border border-zk-border text-xs font-semibold text-zk-accent transition-colors text-center"
            >
              Adjust safety limits
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
