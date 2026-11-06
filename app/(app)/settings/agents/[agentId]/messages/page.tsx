import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { agentPageHref } from "@/lib/header-nav";
import { activeIn } from "@/lib/agents/active-in";

/** An agent's page is addressed by its username now (/settings/agent/{username}); keep old links working. */
export default async function LegacyAgentMessagesPage({ params }: { params: Promise<{ agentId: string }> }) {
  const user = await requireUser();
  const { agentId } = await params;
  const organisationId = await currentOrganisationIdFor(user.id);
  const agent = organisationId
    ? await prisma.agent.findFirst({ where: { id: agentId, ...activeIn(organisationId) }, select: { username: true } })
    : null;
  if (!agent) notFound();
  redirect(agentPageHref(agent.username));
}
