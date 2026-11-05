"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const EVERY_MS = 20_000;

/**
 * Keeps the Live list current (#live-confirm): when an agent confirms an issue
 * is on prod, the dots and counts change without a reload. It re-reads the page
 * every 20 seconds while it is showing, and when you come back to the tab.
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, EVERY_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
