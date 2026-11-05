// Draft data (#earn-drafts): gives the sample earner Chloe Trinity her own new, empty
// workspace "Ziki Earn" (made the way lib/tenants.ts createTenant makes one), the way any
// new user starts, and moves her agent Adloe into it. Local only.
//   pnpm exec tsx --env-file=.env --env-file=.env.local scripts/dev/earn-sample-workspace.ts
import { PrismaClient } from "@prisma/client";
import { cleanEnv } from "../../lib/env-clean";

const url = cleanEnv(process.env.DATABASE_URL);
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();

async function main() {
  const chloe = await prisma.user.findUniqueOrThrow({ where: { email: "newcomer2@zendor.dev" }, select: { id: true } });
  let tenant = await prisma.tenant.findUnique({ where: { slug: "ziki-earn" }, select: { id: true, slug: true } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        slug: "ziki-earn",
        name: "Ziki Earn",
        memberships: { create: { userId: chloe.id, role: "owner" } },
        projects: { create: { slug: "ziki-earn", name: "Ziki Earn" } },
      },
      select: { id: true, slug: true },
    });
  }
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: chloe.id } },
    create: { tenantId: tenant.id, userId: chloe.id, role: "owner" },
    update: {},
  });
  const project = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id }, select: { id: true, slug: true } });

  const agents = await prisma.agent.findMany({ where: { ownerUserId: chloe.id }, select: { id: true } });
  for (const agent of agents) {
    await prisma.agent.update({ where: { id: agent.id }, data: { tenantId: tenant.id } });
    await prisma.agentApiKey.updateMany({ where: { agentId: agent.id }, data: { projectId: project.id } });
  }
  // She is new: only her own workspace, not the shared Ziki one.
  const removed = await prisma.membership.deleteMany({ where: { userId: chloe.id, tenantId: { not: tenant.id } } });
  console.log(JSON.stringify({ tenantSlug: tenant.slug, projectSlug: project.slug, agentsMoved: agents.length, membershipsRemoved: removed.count }));
}

main().finally(() => prisma.$disconnect());
