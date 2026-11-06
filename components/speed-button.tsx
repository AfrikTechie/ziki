"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  SpeedRequestModal,
  type SpeedActionType,
} from "@/components/speed-request-modal";
import {
  expediteBugAction,
  cancelExpediteBugAction,
} from "@/app/actions/expedite";

export interface SpeedButtonProps {
  bugId: string;
  issueNumber: number;
  issueTitle?: string;
  isExpedited?: boolean;
  actionType?: SpeedActionType;
  remainingQuota?: number;
  onExpediteChange?: (isExpedited: boolean, actionType: SpeedActionType) => void;
  className?: string;
}

export function SpeedButton({
  bugId,
  issueNumber,
  issueTitle,
  isExpedited: initialExpedited = false,
  actionType: initialActionType = "triage_vote",
  remainingQuota: initialQuota = 2,
  onExpediteChange,
  className = "",
}: SpeedButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [isExpedited, setIsExpedited] = useState(initialExpedited);
  const [actionType, setActionType] = useState<SpeedActionType>(initialActionType);
  const [quota, setQuota] = useState(initialQuota);
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirm();

  const handleExpediteSubmit = (action: SpeedActionType, note: string) => {
    const prevExpedited = isExpedited;
    const prevQuota = quota;

    // Optimistic update
    setIsExpedited(true);
    setActionType(action);
    setQuota((q) => Math.max(0, q - 1));
    if (onExpediteChange) onExpediteChange(true, action);

    startTransition(async () => {
      try {
        const res = await expediteBugAction(bugId, action, note);
        if (!res.success) {
          // Rollback on error
          setIsExpedited(prevExpedited);
          setQuota(prevQuota);
          if (onExpediteChange) onExpediteChange(prevExpedited, actionType);
        } else if (typeof res.quotaRemaining === "number") {
          setQuota(res.quotaRemaining);
        }
      } catch {
        // Fallback for tests or disconnected environments
      }
    });
  };

  const handleCancelExpedite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: `Remove #${issueNumber} from Blocking Queue?`,
      body: `Remove #${issueNumber} from the Priority Blocking Queue? Your quota will be restored.`,
      confirmLabel: "Remove from Queue",
      tone: "danger",
    });
    if (!confirmed) return;

    const prevExpedited = isExpedited;
    const prevQuota = quota;

    setIsExpedited(false);
    setQuota((q) => Math.min(3, q + 1));
    if (onExpediteChange) onExpediteChange(false, actionType);

    startTransition(async () => {
      try {
        const res = await cancelExpediteBugAction(bugId);
        if (!res.success) {
          setIsExpedited(prevExpedited);
          setQuota(prevQuota);
          if (onExpediteChange) onExpediteChange(prevExpedited, actionType);
        } else if (typeof res.quotaRemaining === "number") {
          setQuota(res.quotaRemaining);
        }
      } catch {
        // Fallback
      }
    });
  };

  return (
    <>
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        {isExpedited ? (
          <div className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 shadow-sm animate-pulse">
            <span className="font-bold text-amber-400">⚡ EXPEDITED</span>
            <span className="text-[11px] text-amber-200/80 hidden sm:inline">
              (Blocking Queue)
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={handleCancelExpedite}
              title="Remove from blocking queue"
              className="ml-1 text-amber-400 hover:text-white transition rounded px-1 hover:bg-amber-500/20 disabled:opacity-50"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setModalOpen(true)}
            title="Spend human urgency quota to force agents to prioritize this issue"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-[#0c1630] hover:bg-amber-500/10 hover:border-amber-400 px-3 py-1 text-xs font-medium text-amber-300 transition shadow-2xs group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50"
          >
            <span className="text-amber-400 group-hover:scale-110 transition-transform">
              ⚡
            </span>
            <span className="font-semibold">Speed Up</span>
            <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[10px] text-amber-300 font-mono">
              {quota}/3
            </span>
          </button>
        )}
      </div>

      <SpeedRequestModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleExpediteSubmit}
        issueNumber={issueNumber}
        issueTitle={issueTitle}
        dailyQuotaRemaining={quota}
        dailyQuotaTotal={3}
      />
    </>
  );
}
