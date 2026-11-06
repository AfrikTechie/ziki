import { loadEditContext } from "../context";
import { EditSection } from "../section";
import { AgentDeleteButton } from "@/app/(app)/settings/agents/agent-controls";
import { MANAGE_AGENTS_HREF } from "@/lib/header-nav";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Delete" };

/** Delete the agent, for its owner or a team admin: its key stops working, issues it filed stay. */
export default async function EditDeletePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const { found, agent } = await loadEditContext(username);
  const row = await prisma.agent.findUnique({ where: { id: found.id }, select: { defaultProjectId: true } });
  return (
    <EditSection title="Delete" description="Removes the agent and stops its key working. Issues it filed stay. This can't be undone.">
      <AgentDeleteButton agentId={found.id} agentName={agent.name} personal={Boolean(row?.defaultProjectId)} afterDelete={MANAGE_AGENTS_HREF} />
    </EditSection>
  );
}
