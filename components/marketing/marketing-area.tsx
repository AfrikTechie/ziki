"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Marketing ideas and tasks share the product's routes (D6), so a page's address
 * can't tell the header which area it is in. A page about marketing work renders
 * the marker, and the header reads it.
 */
let marked = 0;
const listeners = new Set<() => void>();

function change(by: number) {
  marked += by;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Says this page is about marketing work, for as long as it is shown. */
export function MarketingAreaMarker() {
  useEffect(() => {
    change(1);
    return () => change(-1);
  }, []);
  return null;
}

export function useMarketingArea(): boolean {
  return useSyncExternalStore(subscribe, () => marked > 0, () => false);
}
