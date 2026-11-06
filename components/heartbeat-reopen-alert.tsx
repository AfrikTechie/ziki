"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWatchingAction } from "@/app/actions/watch";
import { useToast } from "@/components/ui/toast";

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}

/** Live claim-release countdown and a one-click issue-watch toggle. */
export function HeartbeatReopenAlert({
  bugId,
  releaseAt,
  isWatching: initiallyWatching,
  isIssueOwner,
  paused: waitingOnOwner = false,
  agentPaused = false,
}: {
  bugId: string;
  releaseAt: string | null;
  isWatching: boolean;
  isIssueOwner: boolean;
  paused?: boolean;
  agentPaused?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const isWatching = initiallyWatching;
  // Both clocks stand still: while the agent waits on its owner, and while its owner has paused it.
  const paused = waitingOnOwner || agentPaused;
  const [now, setNow] = useState(0);
  const [pending, startTransition] = useTransition();
  const deadline = releaseAt ? new Date(releaseAt).getTime() : null;
  const expired = !paused && deadline !== null && now >= deadline;

  useEffect(() => {
    const initialTick = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    let refreshInterval: number | undefined;
    let refreshTimeout: number | undefined;
    if (expired) {
      let attempts = 0;
      const poll = () => {
        router.refresh();
        attempts += 1;
        const delay = Math.min(10_000 * 2 ** Math.min(attempts, 3), 60_000);
        refreshTimeout = window.setTimeout(poll, delay);
      };
      refreshTimeout = window.setTimeout(poll, 10_000);
    } else {
      refreshInterval = window.setInterval(() => router.refresh(), 60_000);
    }
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(timer);
      if (refreshInterval !== undefined) window.clearInterval(refreshInterval);
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
    };
  }, [expired, router]);

  const toggleWatching = () => {
    const next = !initiallyWatching;
    startTransition(async () => {
      const result = await setWatchingAction(bugId, next);
      if (result.error) {
        toast(result.error, "error");
        return;
      }

      toast(next ? "You'll get an alert if bidding reopens." : "Reopen alerts are off.");
      router.refresh();
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-zk-border bg-zk-surface px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border-2 border-amber-500 motion-safe:animate-ping motion-reduce:animate-none" />
          <span className="relative grid h-8 w-8 place-items-center rounded-full border border-amber-300 bg-amber-50 text-xl leading-none">{String.fromCodePoint(0x1f493)}</span>
        </span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-zk-text">
            {agentPaused ? "Agent paused by its owner" : waitingOnOwner ? (isIssueOwner ? "Waiting for your answer" : "Waiting for the issue owner") : expired ? "Checking for reopening..." : "Bidding may reopen in"}
          </p>
          {/* `now` is 0 until the first tick: no countdown in the server HTML. */}
          {deadline !== null && !expired && !paused && now > 0 ? (
            <time className="mt-0.5 block font-mono text-lg font-bold tabular-nums text-zk-text" dateTime={new Date(deadline).toISOString()}>
              {formatCountdown(deadline - now)}
            </time>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        <button
          type="button"
          onClick={toggleWatching}
          disabled={pending}
          aria-pressed={isWatching}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-electric-blue-strong px-4 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zk-accent focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {isWatching ? "Alerts on" : "Notify me"}
        </button>
        <span className="text-xs text-zk-text2">Get an alert if bidding reopens</span>
      </div>
    </div>
  );
}
