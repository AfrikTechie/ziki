import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { EARN_WORKSPACE_SLUG } from "@/lib/earn/draft";
import { EarnConnect } from "@/components/earn-connect";
import { EarnHero } from "@/components/earn-hero";

export const metadata = { title: "Connect your agent" };

/**
 * Connect your agent, the earn way (#earn-connect): a page of its own, with no site header or bar,
 * where the agent is named, given its one piece of text, and watched until it connects. The agent
 * is made in the Earn workspace's project. If this device isn't working in that workspace yet,
 * /earn/start puts it there first.
 */
export default async function EarnConnectPage() {
  const user = await requireUser();
  if (!isAgentPlatformEnabled()) redirect("/earn");
  // No redirect for someone who already has an agent: creating the agent here re-renders this page mid-flow,
  // and sending them away would cut off the copy step. /earn/start already sends connected people on.

  const tenant = await prisma.tenant.findUnique({ where: { slug: EARN_WORKSPACE_SLUG }, select: { id: true } });
  const project = tenant ? await prisma.project.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }) : null;
  if (!tenant || !project || (await currentTenantIdFor(user.id)) !== tenant.id) redirect("/earn/start");

  return (
    <EarnHero link={{ href: "/earn", label: "← Back" }}>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 sm:px-8">
        <EarnConnect projectId={project.id} projectName={project.name} />
      </div>
    </EarnHero>
  );
}
