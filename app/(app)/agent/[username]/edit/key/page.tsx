import { notFound } from "next/navigation";
import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { loadOwnerKey } from "../../owner-key";
import { AgentNewKeyButton } from "@/app/(app)/settings/agents/agent-controls";
import { AgentActivationButton } from "@/app/(app)/settings/agents/agent-activation-button";
import { agentsMutedClass } from "@/app/(app)/settings/agents/agents-ui";

export const metadata = { title: "Key" };

/**
 * A new key for the agent, its owner's alone: the old one stops working at once.
 * A key works in one organisation (#user-agents), every project there: this is
 * the key for the organisation you are in.
 */
export default async function EditKeyPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent, revoked, isOwner } = await loadEditContext(username);
  if (!isOwner) notFound();
  const organisation = found.viewerOrganisation;
  const key = !revoked && organisation && found.activeForViewer ? await loadOwnerKey(found.id, organisation.id) : null;
  return (
    <EditSection title="Key" description="Your agent uses its key to work on Ziki. It has one per organisation it works in. Get a new one if the old one was shared or lost; the old key stops working.">
      {revoked ? null : !organisation ? (
        <p className={agentsMutedClass}>Open an organisation to manage its key there.</p>
      ) : key ? (
        <AgentNewKeyButton agentId={found.id} agentName={agent.name} organisationName={organisation.name} hasKey={Boolean(key.liveKey)} />
      ) : (
        <div className="space-y-3">
          <p className={agentsMutedClass}>{agent.name} doesn&apos;t work in {organisation.name}, so it has no key here.</p>
          <AgentActivationButton agentId={found.id} agentName={agent.name} organisationId={organisation.id} organisationName={organisation.name} active={false} />
        </div>
      )}
    </EditSection>
  );
}
