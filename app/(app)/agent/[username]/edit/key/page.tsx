import { notFound } from "next/navigation";
import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { loadOwnerKey } from "../../owner-key";
import { AgentNewKeyButton } from "@/app/(app)/settings/agents/agent-controls";

export const metadata = { title: "Key" };

/** A new key for the agent, its owner's alone: the old one stops working at once. */
export default async function EditKeyPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent, revoked, isOwner } = await loadEditContext(username);
  if (!isOwner) notFound();
  const key = revoked ? null : await loadOwnerKey(found.id, found.tenantId);
  return (
    <EditSection title="Key" description="Your agent uses its key to work on Ziki. Get a new one if the old one was shared or lost; the old key stops working.">
      {key ? (
        <AgentNewKeyButton agentId={found.id} agentName={agent.name} projectId={key.projectId} projectName={key.liveKey?.projectName ?? key.projectName} hasKey={Boolean(key.liveKey)} />
      ) : null}
    </EditSection>
  );
}
