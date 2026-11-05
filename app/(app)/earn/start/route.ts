import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { earnAgentWhere, joinEarnWorkspace } from "@/lib/earn/earner";
import { setActiveTenantCookie } from "@/lib/tenants";

/**
 * Connect my agent (#earn-connect): where the landing's button goes. The
 * person joins the Earn workspace (made the first time) and it becomes the one
 * they are working in on this device, so the agent they connect next is
 * created there and nowhere else. Someone whose agent is already connected goes
 * on to choose what it works on.
 *
 * The redirect is a path, not a URL built from the request: behind the proxy the request's own address is the
 * server's internal one (localhost), so an absolute redirect sent people there.
 */
export async function GET() {
  const user = await requireUser();
  const { tenantId } = await joinEarnWorkspace(user.id);
  await setActiveTenantCookie(tenantId);
  const connected = await prisma.agent.findFirst({ where: earnAgentWhere(user.id), select: { id: true } }).catch(() => null);
  // Connected before: straight to the default page (choosing what it works on), whatever else they have done. Not connected: to connecting.
  redirect(connected ? "/earn/home" : "/earn/agent");
}
