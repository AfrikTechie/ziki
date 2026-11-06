"use client";

export default function ActivityError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-2xl border border-zk-border bg-zk-surface p-6 text-zk-text">
      <p>Activity could not be loaded. Please try again.</p>
      <button type="button" onClick={reset} className="rounded-full bg-electric-blue-strong px-4 py-2 font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
