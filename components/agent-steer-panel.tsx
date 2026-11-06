"use client";

import { useState, useTransition } from "react";
import { sendIssueSteer, setAgentPaused } from "@/app/actions/agent-steering";

export function AgentSteerPanel({ agentId, issueId, paused, notes }: {
  agentId: string;
  issueId: string;
  paused: boolean;
  /** Notes already sent, newest first, each with the plan the agent answered with. */
  notes: { id: string; body: string; plan: string | null }[];
}) {
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const [pausePending, startPauseTransition] = useTransition();
  return (
    <section aria-label="Steer agent" className="mb-4 rounded-xl border border-zk-border bg-zk-surface p-4">
      <h3 className="font-semibold text-zk-text">Steer this agent</h3>
      <p className="mt-1 text-sm text-zk-muted">Your note is delivered in the agent inbox on its next poll.</p>
      <form className="mt-3 space-y-2" onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await sendIssueSteer(agentId, issueId, body);
          setNotice(result.ok ? "Steer note sent." : result.error);
          if (result.ok) setBody("");
        });
      }}>
        <textarea aria-label="Steer note" maxLength={2000} required value={body} onChange={(event) => setBody(event.target.value)} className="w-full rounded-lg border border-zk-border bg-zk-surface p-2 text-sm text-zk-text" rows={3} placeholder="What should the agent focus on?" />
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-sm text-zk-muted">{notice}</p>
          <button disabled={pending} className="rounded-full bg-electric-blue-strong px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Sending…" : "Send steer"}</button>
        </div>
      </form>
      {notes.length ? (
        <ul className="mt-3 space-y-2 border-t border-zk-border pt-3 text-sm">
          {notes.map((note) => (
            <li key={note.id}>
              <p className="whitespace-pre-wrap break-words text-zk-text">{note.body}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-zk-muted">{note.plan ? `Agent's plan: ${note.plan}` : "Not acknowledged yet."}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" disabled={pausePending} onClick={() => startPauseTransition(async () => {
        const result = await setAgentPaused(agentId, !paused);
        setNotice(result.ok ? (paused ? "Agent resumed." : "Agent paused.") : result.error);
        if (result.ok) window.location.reload();
      })} className="mt-2 rounded-full border border-zk-border px-3 py-1.5 text-xs font-semibold text-zk-text hover:bg-zk-chip disabled:opacity-50">
        {pausePending ? "Updating…" : paused ? "Resume agent" : "Pause agent"}
      </button>
    </section>
  );
}
