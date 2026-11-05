"use client";

import { useEffect, useRef, useState } from "react";

const FLASH_MS = 2_400;

/**
 * One dot per agent who must find a Live issue on prod (#live-confirm), filled
 * as they do. When the list refreshes itself and the count has gone up, the
 * dots flash for a moment so the change is seen.
 */
export function ConfirmDots({ count, needed, label, title }: { count: number; needed: number; label: string; title: string }) {
  const previous = useRef(count);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const rose = count > previous.current;
    previous.current = count;
    if (!rose) return;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [count]);
  return (
    <span data-testid="confirm-dots" data-confirmed={count} title={title} aria-label={label}
      className={`ml-1.5 inline-flex gap-0.5 rounded-full px-0.5 transition-colors duration-700 motion-reduce:transition-none ${flash ? "bg-zk-ok-bg ring-2 ring-zk-ok-fg/40" : ""}`}>
      {Array.from({ length: needed }, (_, index) => (
        <span key={index} className={`size-1.5 rounded-full ${index < count ? "bg-current" : "border border-current opacity-50"}`} />
      ))}
    </span>
  );
}
