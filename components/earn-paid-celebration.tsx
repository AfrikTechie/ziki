"use client";

import { useEffect, useState } from "react";
import { EarnCelebrationModal } from "@/components/earn-celebration-modal";

const SEEN_KEY = "earn-paid-celebrated";

function readSeen(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A paid task, celebrated (#earn-celebrate): the first time an earner opens an earn page after Ziki has paid a
 * task, a celebration pops up for it, once. Which ones were celebrated is remembered in this browser. When the
 * browser can't remember (private windows), nothing pops up rather than the same one every time.
 */
export function EarnPaidCelebration({ paid, agentName }: { paid: { key: string; title: string; pay: number }[]; agentName: string }) {
  const [current, setCurrent] = useState<{ key: string; title: string; pay: number } | null>(null);

  useEffect(() => {
    let storageWorks = true;
    try {
      window.localStorage.setItem(`${SEEN_KEY}-probe`, "1");
      window.localStorage.removeItem(`${SEEN_KEY}-probe`);
    } catch {
      storageWorks = false;
    }
    if (!storageWorks) return;
    const seen = readSeen();
    const next = paid.find((task) => !seen.includes(task.key));
    if (!next) return;
    const timer = setTimeout(() => setCurrent(next), 400);
    return () => clearTimeout(timer);
  }, [paid]);

  if (!current) return null;
  const close = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), current.key])]));
    } catch {
      // Nothing to remember it with; it closes all the same.
    }
    setCurrent(null);
  };
  return (
    <EarnCelebrationModal
      amount={current.pay}
      title="Task paid"
      message={`Ziki checked “${current.title}” and paid you. Nice work, you and ${agentName}.`}
      action={{ href: "/earn/marketing", label: "Do another task" }}
      onClose={close}
    />
  );
}
