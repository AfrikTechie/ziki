import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { findPendingPairing } from "@/lib/agents/pairing";
import { AGENT_INSTRUCTIONS_MAX } from "@/lib/agent-messages";
import { projectContextFor } from "@/lib/project-context";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { PairForm } from "./pair-form";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import {
  agentsChipClass,
  agentsLink,
  agentsMutedClass,
  agentsSurface,
  formatPairingCode,
} from "../agents-ui";

export const metadata = { title: "Approve an agent" };

/** Where an agent sends its owner to approve a request (#427). */
export default async function PairAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const user = await requireUser();
  if (!isAgentPlatformEnabled()) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold text-zk-text">Approve an agent</h1>
          <p className={agentsMutedClass}>The agent platform feature is not enabled in this environment.</p>
        </div>
      </div>
    );
  }
  const organisationId = await currentOrganisationIdFor(user.id);
  const context = await projectContextFor(prisma, organisationId);
  const { code } = await searchParams;
  const rawCode = typeof code === "string" ? code.slice(0, 20) : "";
  const initialCode = formatPairingCode(rawCode);
  const pending = initialCode ? await findPendingPairing(initialCode) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-3">
        <Link href="/settings/agents" className={`text-sm ${agentsLink}`}>
          ← Back to agents
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-zk-text">Approve an agent</h1>
        <p className="text-sm text-zk-text2">Your agent asked to join this account. Check its name and approve it.</p>
        <div className="flex flex-wrap gap-2">
          <span className={agentsChipClass}>Lasts 15 minutes</span>
          <span className={agentsChipClass}>Works once</span>
          <span className={agentsChipClass}>Key goes to the agent, not this page</span>
        </div>
        <p className="text-xs text-zk-muted">
          Signed in as <span className="font-semibold text-zk-text">{user.name}</span>
        </p>
      </div>
      <section className={`${agentsSurface} p-4 sm:p-6`}>
        {!organisationId ? (
          <p className="text-sm text-zk-text2">
            Join or create an organisation before you can approve an agent.{" "}
            <Link href="/organisations" className={`font-semibold ${agentsLink}`}>
              Organisations
            </Link>
          </p>
        ) : (
          <PairForm
            initialCode={initialCode}
            pending={
              pending
                ? {
                    name: pending.proposedName,
                    model: pending.proposedModel,
                    level: pending.proposedLevel,
                    instructions: pending.proposedInstructions,
                  }
                : null
            }
            unknownCode={Boolean(initialCode) && !pending}
            projects={context.projects}
            activeProjectId={context.activeProjectId}
            instructionsMaxLength={AGENT_INSTRUCTIONS_MAX}
          />
        )}
      </section>
    </div>
  );
}
