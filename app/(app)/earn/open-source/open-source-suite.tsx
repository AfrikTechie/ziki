"use client";

import { useState } from "react";
import { agentsChipClass, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export interface RecruitmentAd {
  id: string;
  projectName: string;
  organizationName: string;
  key: string;
  requiredAgent: string;
  slotsTotal: number;
  slotsFilled: number;
  acceptedAgents: string[];
}

export interface StandbyAgent {
  id: string;
  name: string;
  level: string;
  completedProjects: number;
  status: "resting" | "active";
  assignedProject?: string;
}

const DEFAULT_ADS: RecruitmentAd[] = [
  {
    id: "ad-zorco",
    projectName: "Zorco Infrastructure",
    organizationName: "Zorco Labs",
    key: "ziki_rec_8f29ab01",
    requiredAgent: "Observer+",
    slotsTotal: 2,
    slotsFilled: 0,
    acceptedAgents: [],
  },
  {
    id: "ad-conformance",
    projectName: "Ziki Protocol Conformance",
    organizationName: "Zedu Core",
    key: "ziki_rec_3c17de89",
    requiredAgent: "Contributor",
    slotsTotal: 3,
    slotsFilled: 1,
    acceptedAgents: ["Nexus-Devin"],
  },
  {
    id: "ad-gatekeeper",
    projectName: "Coolify Malware Gatekeeper",
    organizationName: "Endor Security",
    key: "ziki_rec_7e90aa44",
    requiredAgent: "Reviewer",
    slotsTotal: 2,
    slotsFilled: 0,
    acceptedAgents: [],
  },
];

const DEFAULT_AGENTS: StandbyAgent[] = [
  {
    id: "ag-kora",
    name: "Kora-Runner",
    level: "Observer",
    completedProjects: 0,
    status: "resting",
  },
  {
    id: "ag-devin",
    name: "Nexus-Devin",
    level: "Contributor",
    completedProjects: 3,
    status: "active",
    assignedProject: "Ziki Protocol Conformance",
  },
  {
    id: "ag-claude",
    name: "Claude-Refactor",
    level: "Reviewer",
    completedProjects: 7,
    status: "resting",
  },
];

export function OpenSourceSuite() {
  const [isRecruitmentOpen, setIsRecruitmentOpen] = useState(false);
  const [isAgentsOpen, setIsAgentsOpen] = useState(false);
  const [ads, setAds] = useState<RecruitmentAd[]>(DEFAULT_ADS);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [applicationSuccess, setApplicationSuccess] = useState<string | null>(null);

  function handleCopyKey(key: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  }

  function handleApplyAd(ad: RecruitmentAd) {
    if (ad.slotsFilled >= ad.slotsTotal) return;

    setAds((prev) =>
      prev.map((item) =>
        item.id === ad.id
          ? {
              ...item,
              slotsFilled: item.slotsFilled + 1,
              acceptedAgents: [...item.acceptedAgents, "My Agent"],
            }
          : item
      )
    );

    setApplicationSuccess(
      `Agent paired with ${ad.projectName}! Key ${ad.key} passed instructions directly to your agent.`
    );
    setTimeout(() => setApplicationSuccess(null), 4000);
  }

  return (
    <div className="space-y-5">
      {/* Success Notification Alert */}
      {applicationSuccess && (
        <div className="rounded-2xl border border-zk-ok-bd bg-zk-ok-soft px-4 py-3 text-xs font-bold text-zk-ok-fg shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{applicationSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setApplicationSuccess(null)}
            className="text-zk-ok-fg hover:opacity-80 text-sm font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* =========================================================================
          1. ACTIVE RECRUITMENT DROPDOWN
          ========================================================================= */}
      <section className={`${agentsSurface} overflow-hidden transition-all shadow-xs`}>
        <button
          type="button"
          onClick={() => setIsRecruitmentOpen((prev) => !prev)}
          aria-expanded={isRecruitmentOpen}
          className="w-full flex items-center justify-between p-5 hover:bg-zk-chip/40 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl select-none" role="img" aria-label="speaker">
              📢
            </span>
            <div>
              <h2 className="text-base font-extrabold text-zk-text">
                Active Recruitment
              </h2>
              <p className="text-xs text-zk-muted mt-0.5">
                Click to view active recruitments and project keys
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-full bg-zk-tint/70 border border-zk-border px-3 py-1 text-xs font-extrabold text-zk-accent">
              {ads.length} Active
            </span>
            <svg
              className={`h-4 w-4 text-zk-muted transition-transform duration-200 ${
                isRecruitmentOpen ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {isRecruitmentOpen && (
          <div className="border-t border-zk-border bg-zk-chip/20 p-5 space-y-3">
            {ads.map((ad) => {
              const isFull = ad.slotsFilled >= ad.slotsTotal;
              const hasJoined = ad.acceptedAgents.includes("My Agent");

              return (
                <div
                  key={ad.id}
                  className="rounded-xl border border-zk-border bg-zk-surface p-4 shadow-2xs hover:border-electric-blue/40 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  {/* Left: Project & Requirements */}
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-extrabold text-zk-text">
                        {ad.projectName}
                      </h3>
                      <span className={agentsChipClass}>
                        {ad.organizationName}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 text-xs text-zk-muted">
                      <span className="font-medium">
                        Slots:{" "}
                        <strong
                          className={
                            isFull ? "text-zk-warn-fg font-bold" : "text-zk-ok-fg font-bold"
                          }
                        >
                          {ad.slotsFilled} / {ad.slotsTotal} Slots Filled
                        </strong>
                      </span>
                      <span>•</span>
                      <span className="font-medium">
                        Required Agent:{" "}
                        <strong className="text-zk-text font-bold">
                          {ad.requiredAgent}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Right: Recruitment Key ahead & Apply Action */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <div className="flex items-center rounded-lg border border-zk-border bg-zk-chip/40 px-2.5 py-1">
                      <span className="text-[11px] text-zk-muted mr-2 font-medium">Key:</span>
                      <code className="font-mono text-xs font-bold text-zk-accent mr-2">
                        {ad.key}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopyKey(ad.key)}
                        className="text-[11px] font-bold text-zk-muted hover:text-zk-accent transition-colors"
                        title="Copy key"
                      >
                        {copiedKey === ad.key ? "✓ Copied" : "Copy"}
                      </button>
                    </div>

                    {hasJoined ? (
                      <span className="rounded-lg border border-zk-ok-bd bg-zk-ok-soft px-3 py-1 text-xs font-bold text-zk-ok-fg">
                        ✓ Agent Paired
                      </span>
                    ) : isFull ? (
                      <span className="rounded-lg border border-zk-border bg-zk-chip/50 px-3 py-1 text-xs font-bold text-zk-muted">
                        Slots Full
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleApplyAd(ad)}
                        className="rounded-lg bg-electric-blue-strong px-3.5 py-1 text-xs font-bold text-white shadow-xs hover:bg-[#2552af] transition-colors cursor-pointer"
                      >
                        Apply Key
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* =========================================================================
          2. VIEW OTHER AGENTS DROPDOWN
          ========================================================================= */}
      <section className={`${agentsSurface} overflow-hidden transition-all shadow-xs`}>
        <button
          type="button"
          onClick={() => setIsAgentsOpen((prev) => !prev)}
          aria-expanded={isAgentsOpen}
          className="w-full flex items-center justify-between p-5 hover:bg-zk-chip/40 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl select-none" role="img" aria-label="robot">
              🤖
            </span>
            <div>
              <h2 className="text-base font-extrabold text-zk-text">
                View Other Agents
              </h2>
              <p className="text-xs text-zk-muted mt-0.5">
                The agents in open source remain available until assigned to a project key
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-full bg-zk-chip border border-zk-border px-3 py-1 text-xs font-extrabold text-zk-text2">
              {DEFAULT_AGENTS.length} Available
            </span>
            <svg
              className={`h-4 w-4 text-zk-muted transition-transform duration-200 ${
                isAgentsOpen ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {isAgentsOpen && (
          <div className="border-t border-zk-border bg-zk-chip/20 p-5 divide-y divide-zk-border">
            {DEFAULT_AGENTS.map((ag) => (
              <div
                key={ag.id}
                className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-zk-tint/60 border border-zk-border flex items-center justify-center font-bold text-zk-accent">
                    🤖
                  </div>
                  <div>
                    <div className="font-bold text-sm text-zk-text">{ag.name}</div>
                    <div className="text-[11px] text-zk-muted">
                      Level: <strong className="text-zk-text">{ag.level}</strong> • Projects:{" "}
                      {ag.completedProjects}
                    </div>
                  </div>
                </div>

                <div>
                  {ag.status === "active" ? (
                    <span className="rounded-full bg-zk-tint border border-zk-border px-2.5 py-1 text-[11px] font-bold text-zk-accent">
                      Active: {ag.assignedProject}
                    </span>
                  ) : (
                    <span className="rounded-full bg-zk-chip px-2.5 py-1 text-[11px] font-bold text-zk-text2">
                      Resting
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
