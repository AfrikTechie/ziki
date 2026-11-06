"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { correct } from "@/lib/points/correct";
import { clearLeaderboardCache } from "@/lib/points/leaderboard";
import { agentPointsToReverse } from "@/lib/points/reset-agent-points";

const BATCH = 200;

/**
 * Super admin: reverse every point an agent earned in one organisation.
 *
 * Nothing is deleted. Each entry gets a correcting entry through the ledger's
 * usual `correct()` (sourceKey `undo:{id}`), so balances drop to zero for that
 * agent work, the history stays, and running it twice changes nothing.
 */
export async function resetAgentPointsAction(formData: FormData) {
  await requireSuperAdmin();
  const slug = String(formData.get("slug") ?? "");
  const organisation = await prisma.organisation.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!organisation) redirect("/superadmin/users");

  let reversed = 0;
  for (;;) {
    const batch = await prisma.pointEntry.findMany({
      where: agentPointsToReverse(organisation.id),
      take: BATCH,
      select: { id: true, organisationId: true, userId: true, bugId: true, role: true, points: true, agentId: true },
    });
    if (batch.length === 0) break;
    await prisma.$transaction(
      async (tx) => {
        for (const entry of batch) await correct(tx, { entry });
      },
      { timeout: 60_000 },
    );
    reversed += batch.length;
  }

  clearLeaderboardCache(organisation.id);
  revalidatePath(`/superadmin/orgs/${organisation.slug}`);
  redirect(`/superadmin/orgs/${organisation.slug}?reversed=${reversed}`);
}
