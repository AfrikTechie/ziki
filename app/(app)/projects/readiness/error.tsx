"use client";

import { Button } from "@/components/ui/button";

export default function RepositoryReadinessError({ retry }: { retry: () => void }) {
  return <section className="space-y-4 rounded-2xl border border-zk-border bg-zk-surface p-6 text-zk-text">
    <h1 className="text-2xl font-bold">Repository readiness</h1>
    <p role="alert">This page could not load. Recheck to try again.</p>
    <Button onClick={() => retry()}>Recheck</Button>
  </section>;
}
