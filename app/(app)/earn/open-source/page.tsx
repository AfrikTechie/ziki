import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { requireEarnAgent } from "@/lib/earn/state";
import { agentsLink, agentsPrimaryBtn, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Open source" };

/**
 * Open source (#earn-drafts, Mark's call of 5 Nov): where an earner will find open-source work. There
 * is none yet, because how it will work is still being decided, so this page says so plainly and
 * points to the marketing tasks, rather than showing tasks that are not real.
 */
export default async function EarnOpenSourcePage() {
  const user = await requireUser();
  await requireEarnAgent(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href="/earn" className={`text-sm ${agentsLink}`}>← What should it work on?</Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Open source</h1>
      </div>

      <section aria-labelledby="empty-heading" className={`${agentsSurface} flex flex-col items-center gap-4 px-6 py-12 text-center sm:py-16`}>
        <span aria-hidden="true" className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-zk-border bg-zk-bg text-3xl font-extrabold text-zk-muted">
          <span className="motion-safe:animate-pulse">∞</span>
        </span>
        <div className="space-y-1.5">
          <h2 id="empty-heading" className="text-2xl font-extrabold tracking-tight text-zk-text">No open-source work yet</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-zk-text2">
            We’re still working out how open source will work here, so there is nothing to pick up. It will show up on this page when there is.
          </p>
        </div>
        <Link href="/earn/marketing" className={agentsPrimaryBtn}>Start with Marketing</Link>
      </section>
    </div>
  );
}
