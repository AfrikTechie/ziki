"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/ui/character-counter";
import { SUPPORT_MESSAGE_MAX } from "@/lib/validations/support-thread";
import {
  takeSupportThreadAction,
  replySupportThreadAction,
  addRequesterMessageAction,
  releaseSupportThreadAction,
  resolveSupportThreadAction,
} from "@/app/actions/support-threads";

const muted = "text-sm text-zk-muted";

export function TakeRequestControls({
  threadId,
  eligibleAgents,
}: {
  threadId: string;
  eligibleAgents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedAgentId, setSelectedAgentId] = useState<string>(eligibleAgents[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  if (eligibleAgents.length === 0) {
    return (
      <p className={muted}>
        Only manager or merger agents can take requests. You don&apos;t own an eligible agent in this workspace.
      </p>
    );
  }

  const handleTake = () => {
    if (!selectedAgentId) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await takeSupportThreadAction({ threadId, agentId: selectedAgentId });
        if (res.ok) {
          router.refresh();
        } else {
          setError(res.error);
        }
      } catch {
        setError("Could not take request. Please try again.");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {eligibleAgents.length > 1 ? (
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            disabled={isPending}
            className="rounded-lg border border-zk-border bg-zk-surface px-3 py-1.5 text-sm font-semibold text-zk-text focus:outline-none focus:ring-2 focus:ring-electric-blue-strong"
          >
            {eligibleAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        ) : null}
        <Button
          type="button"
          disabled={isPending || !selectedAgentId}
          onClick={handleTake}
          className="rounded-full bg-electric-blue-strong px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          {isPending ? "Taking…" : eligibleAgents.length === 1 ? `Take it as ${eligibleAgents[0].name}` : "Take it"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AgentReplyComposer({
  threadId,
  agentName,
}: {
  threadId: string;
  agentName: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await replySupportThreadAction({ threadId, body });
        if (res.ok) {
          setBody("");
          router.refresh();
        } else {
          setError(res.error);
        }
      } catch {
        setError("Could not send reply. Please try again.");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Reply as ${agentName}…`}
        rows={3}
        maxLength={SUPPORT_MESSAGE_MAX}
        disabled={isPending}
        className="border-zk-border bg-zk-surface text-zk-text placeholder:text-zk-muted"
      />
      <div className="flex items-center justify-between">
        <CharacterCounter length={body.length} max={SUPPORT_MESSAGE_MAX} />
        <Button
          type="submit"
          disabled={isPending || !body.trim()}
          className="rounded-full bg-electric-blue-strong px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          {isPending ? "Sending…" : `Reply as ${agentName}`}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function RequesterFollowUpComposer({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await addRequesterMessageAction({ threadId, body });
        if (res.ok) {
          setBody("");
          router.refresh();
        } else {
          setError(res.error);
        }
      } catch {
        setError("Could not send message. Please try again.");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a follow-up message…"
        rows={3}
        maxLength={SUPPORT_MESSAGE_MAX}
        disabled={isPending}
        className="border-zk-border bg-zk-surface text-zk-text placeholder:text-zk-muted"
      />
      <div className="flex items-center justify-between">
        <CharacterCounter length={body.length} max={SUPPORT_MESSAGE_MAX} />
        <Button
          type="submit"
          disabled={isPending || !body.trim()}
          className="rounded-full bg-electric-blue-strong px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          {isPending ? "Sending…" : "Send message"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ReleaseRequestButton({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleRelease = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await releaseSupportThreadAction({ threadId });
        if (res.ok) {
          router.refresh();
        } else {
          setError(res.error);
        }
      } catch {
        setError("Could not release request. Please try again.");
      }
    });
  };

  return (
    <div className="inline-flex flex-col">
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={handleRelease}
        className="rounded-full border border-zk-border bg-zk-surface px-3 py-1.5 text-xs font-semibold text-zk-text hover:bg-zk-chip"
      >
        {isPending ? "Releasing…" : "Release request"}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ResolveRequestButton({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleResolve = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await resolveSupportThreadAction({ threadId });
        if (res.ok) {
          router.refresh();
        } else {
          setError(res.error);
        }
      } catch {
        setError("Could not resolve request. Please try again.");
      }
    });
  };

  return (
    <div className="inline-flex flex-col">
      <Button
        type="button"
        disabled={isPending}
        onClick={handleResolve}
        className="rounded-full bg-zk-ok-fg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
      >
        {isPending ? "Resolving…" : "✓ Mark resolved"}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-zk-bad-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

