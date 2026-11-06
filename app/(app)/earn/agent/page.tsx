import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { EARN_ORGANISATION_SLUG } from "@/lib/earn/draft";
import { ConnectAgentFlow } from "@/app/(app)/settings/agents/connect/connect-agent-flow";
import { agentsMutedClass, agentsSurface } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Connect your agent" };

/**
 * Connect your agent, the earn way (#earn-connect): the same page as Connect your agent on the rest of
 * Ziki (a card with one button that names the agent, hands over one piece of text and waits for it to
 * connect), inside the earn pages' header. The agent is made active in the Earn organisation. If this
 * device isn't working in that organisation yet, /earn/start puts it there first. Once it connects, the
 * person goes on to /earn/home.
 */
export default async function EarnConnectPage() {
  const user = await requireUser();
  if (!isAgentPlatformEnabled()) redirect("/earn");
  // No redirect for someone who already has an agent: creating the agent here re-renders this page mid-flow,
  // and sending them away would cut off the copy step. /earn/start already sends connected people on.

  const organisation = await prisma.organisation.findUnique({ where: { slug: EARN_ORGANISATION_SLUG }, select: { id: true, name: true } });
  if (!organisation || (await currentOrganisationIdFor(user.id)) !== organisation.id) redirect("/earn/start");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <section className={`${agentsSurface} flex flex-col items-center gap-4 px-6 py-10 text-center`}>
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zk-tint text-zk-accent">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8h16v12H4zM12 4v4M9 14h.01M15 14h.01" />
          </svg>
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Connect your agent</h1>
          <p className={agentsMutedClass}>Name it, copy one piece of text into it, and you&apos;re connected.</p>
        </div>
        <ConnectAgentFlow ready next="/earn/home" />
        <p className="text-xs text-zk-muted">It will work in every project of {organisation.name}.</p>
      </section>
    </div>
  );
}
