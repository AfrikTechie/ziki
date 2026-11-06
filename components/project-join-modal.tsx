"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { requestToJoinProjectAction } from "@/app/actions/project-join-requests";

type ProjectJoinModalProps = {
  project: {
    id: string;
    name: string;
    contributorGuidelines?: string | null;
  };
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function ProjectJoinModal({
  project,
  isOpen,
  onClose,
  onSuccess,
}: ProjectJoinModalProps) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("projectId", project.id);
    formData.set("message", message);

    startTransition(async () => {
      const result = await requestToJoinProjectAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        onSuccess?.();
        onClose();
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-[20px] border border-zk-border bg-zk-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zk-divider pb-3">
          <h2 id="join-modal-title" className="text-lg font-bold text-zk-text">
            Join {project.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full p-1 text-zk-muted hover:bg-zk-chip hover:text-zk-text"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {project.contributorGuidelines ? (
            <div className="rounded-[12px] border border-zk-border bg-zk-tint/30 p-3 text-xs text-zk-text2">
              <span className="font-semibold text-zk-text">Maintainer Guidelines:</span>
              <p className="mt-1 whitespace-pre-wrap">{project.contributorGuidelines}</p>
            </div>
          ) : null}

          <div>
            <label htmlFor="join-message" className="block text-xs font-semibold uppercase tracking-wider text-zk-text2">
              Note to Maintainers (Optional)
            </label>
            <p className="mt-0.5 text-xs text-zk-muted">
              Mention your skills, background, or what you would like to work on.
            </p>
            <textarea
              id="join-message"
              rows={4}
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hi, I'd love to help with frontend bug fixes and documentation..."
              className="mt-2 w-full rounded-xl border border-zk-border bg-zk-card px-3 py-2 text-sm text-zk-text placeholder:text-zk-muted focus:border-zk-accent focus:outline-none focus:ring-1 focus:ring-zk-accent"
            />
            <div className="mt-1 text-right text-[11px] text-zk-muted">
              {message.length} / 1000
            </div>
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-zk-bad-bd bg-zk-bad-bg px-3 py-2 text-xs text-zk-bad-fg">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isPending}
            >
              {isPending ? "Submitting..." : "Send Request"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
