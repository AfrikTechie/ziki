import "server-only";
import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secret-box";

/**
 * An agent's live key in one organisation (#user-agents), for its owner only
 * (its page's Connect panel and its settings' Key page): the newest, with the
 * key itself when its seal still opens. A key works in every project of its
 * organisation.
 */
export async function loadOwnerKey(agentId: string, organisationId: string) {
  const key = await prisma.agentApiKey.findFirst({
    where: { agentId, organisationId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { prefix: true, sealedKey: true, lastUsedAt: true },
  });
  let apiKey: string | null = null;
  if (key?.sealedKey) {
    try {
      apiKey = openSecret(key.sealedKey);
    } catch {
      apiKey = null;
    }
  }
  return {
    liveKey: key ? { apiKey, prefix: key.prefix, lastUsedAt: key.lastUsedAt?.toISOString() ?? null } : null,
  };
}
