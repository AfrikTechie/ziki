import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentOrgPathFor, firstProjectRefFor } from "@/lib/project-route";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { ideasPath } from "@/lib/project-paths";
import { EARN_WORKSPACE_SLUG } from "@/lib/earn/draft";

/**
 * `/home`: where Ziki sends you when no project is named (after sign-in, from
 * a 404, from the logo with no project, and when you switch workspace). It
 * opens the Ideas of the current workspace's default project (Web when it has
 * one), its Projects page when it has no projects yet, or the workspace picker
 * when there is no workspace. The Ziki Earn workspace has no builders'
 * pages to open: its front door is /earn/home, so that is where it opens.
 */
export default async function HomePage() {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    if (tenant?.slug === EARN_WORKSPACE_SLUG) redirect("/earn/home");
  }
  const slug = await firstProjectRefFor(user.id);
  if (slug) redirect(ideasPath(slug));
  redirect((await currentOrgPathFor(user.id)) ?? "/tenants");
}
