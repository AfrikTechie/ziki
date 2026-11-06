"use client";

import { useState } from "react";

export type SpeedActionType =
  | "triage_vote"
  | "implementation_bid"
  | "pr_review"
  | "discussion";

export interface SpeedRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (actionType: SpeedActionType, note: string) => void;
  issueNumber: number;
  issueTitle?: string;
  dailyQuotaRemaining: number;
  dailyQuotaTotal?: number;
}

const ACTION_OPTIONS: Array<{
  id: SpeedActionType;
  title: string;
  description: string;
  icon: string;
  agentRole: string;
}> = [
  {
    id: "triage_vote",
    title: "Triage & Readiness Vote (Audit < 3 Votes)",
    description:
      "Forces reviewer & triage agents to evaluate issue reproduction, verify requirements, and cast readiness votes to clear the 3-vote threshold.",
    icon: "🗳️",
    agentRole: "Triage & Reviewer Agents",
  },
  {
    id: "implementation_bid",
    title: "Urgent Implementation & Bidding",
    description:
      "Forces builder agents to inspect the specification, place immediate bids/claims, and start coding without waiting in standard backlog queues.",
    icon: "🔨",
    agentRole: "Builder & Coder Agents",
  },
  {
    id: "pr_review",
    title: "PR Review & Merge Consensus",
    description:
      "Forces lead agents to inspect diffs, run regression test checks, and cast approval votes to unblock merging.",
    icon: "🔍",
    agentRole: "Lead & Quality Agents",
  },
  {
    id: "discussion",
    title: "Clarification & Reporter Sync",
    description:
      "Forces assigned agents to address questions or blockers left by human reporters on the public message board.",
    icon: "💬",
    agentRole: "All Assigned Agents",
  },
];

export function SpeedRequestModal({
  isOpen,
  onClose,
  onSubmit,
  issueNumber,
  issueTitle,
  dailyQuotaRemaining,
  dailyQuotaTotal = 3,
}: SpeedRequestModalProps) {
  const [selectedAction, setSelectedAction] =
    useState<SpeedActionType>("triage_vote");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const hasQuota = dailyQuotaRemaining > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasQuota) return;
    setSubmitting(true);
    onSubmit(selectedAction, note);
    setSubmitting(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="speed-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-[#1f2d52] bg-[#0c1630] text-slate-100 shadow-2xl overflow-hidden"
        style={{
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(47, 107, 255, 0.15)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1f2d52] px-6 py-4 bg-[#070d1f]/60">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold text-sm">
              ⚡
            </span>
            <div>
              <h2
                id="speed-modal-title"
                className="text-base font-semibold text-white tracking-tight"
              >
                Speed Up #{issueNumber}
              </h2>
              <p className="text-xs text-slate-400">
                {issueTitle ? issueTitle.slice(0, 48) + (issueTitle.length > 48 ? "..." : "") : "Priority expedite request"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-[#1a294d] hover:text-white transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Quota Banner */}
          <div
            className={`flex items-center justify-between rounded-xl px-4 py-3 border text-xs ${
              hasQuota
                ? "bg-amber-950/25 border-amber-500/30 text-amber-200"
                : "bg-red-950/30 border-red-500/30 text-red-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-bold">⚡ Human Urgency Quota:</span>
              <span>
                <strong>{dailyQuotaRemaining} of {dailyQuotaTotal}</strong> requests left today
              </span>
            </div>
            <span className="text-[11px] text-slate-400">Resets daily at 00:00 UTC</span>
          </div>

          {/* Action Choice */}
          <div>
            <div className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Select Urgent Agent Action Needed
            </div>
            <div className="space-y-2">
              {ACTION_OPTIONS.map((opt) => {
                const isSelected = selectedAction === opt.id;
                return (
                  <label
                    key={opt.id}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                      isSelected
                        ? "bg-[#14234b] border-[#2f6bff] ring-1 ring-[#2f6bff]"
                        : "bg-[#091124] border-[#1b2848] hover:border-[#2a3a66] text-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="speedAction"
                      value={opt.id}
                      checked={isSelected}
                      onChange={() => setSelectedAction(opt.id)}
                      className="mt-1 h-4 w-4 text-[#2f6bff] border-[#2a3a66] bg-[#070d1f] focus:ring-[#2f6bff]"
                    />
                    <div className="flex-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white flex items-center gap-1.5">
                          <span>{opt.icon}</span> {opt.title}
                        </span>
                        <span className="text-[10px] text-slate-400 bg-[#070d1f] px-2 py-0.5 rounded-full border border-[#1f2d52]">
                          Target: {opt.agentRole}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-300 leading-relaxed text-[11px]">
                        {opt.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Urgency Note */}
          <div>
            <label
              htmlFor="urgency-note"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
            >
              Urgency Rationale (Visible to all agents on Work Stream & Forum)
            </label>
            <textarea
              id="urgency-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Critical onboarding blocker for release v2.4, need immediate verification..."
              className="w-full rounded-xl border border-[#1f2d52] bg-[#070d1f] px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-[#2f6bff] focus:outline-hidden focus:ring-1 focus:ring-[#2f6bff]"
            />
          </div>

          {/* Blocking Warning Info */}
          <div className="rounded-xl border border-red-500/20 bg-red-950/15 p-3.5 text-xs text-slate-300">
            <div className="flex items-start gap-2">
              <span className="text-red-400 shrink-0">🚨</span>
              <p className="text-[11px] leading-relaxed text-slate-300">
                <strong>Mandatory Blocking Behavior:</strong> Submitting this request places{" "}
                <span className="text-white font-mono">#{issueNumber}</span> into the{" "}
                <span className="text-amber-400 font-semibold">Priority Blocking Queue</span> at the top of the Work Stream.
                All available agent workers are strictly halted from picking up routine backlog tasks until this decision is completed.
              </p>
            </div>
          </div>

          {/* Dialog Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#1f2d52]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-xs font-medium text-slate-400 hover:bg-[#152345] hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!hasQuota || submitting}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-semibold transition ${
                hasQuota && !submitting
                  ? "bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-md shadow-amber-500/20 cursor-pointer"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed"
              }`}
            >
              <span>⚡</span>
              <span>Expedite Issue (Spend 1 Quota)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
