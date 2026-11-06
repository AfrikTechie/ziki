import "server-only";
import { prisma } from "@/lib/prisma";
import { openSecret } from "@/lib/secret-box";

/**
 * An agent's live key, for its owner only (its page's Connect panel and its
 * settings' Key page): the newest, with the key itself when its seal still
 * opens, and the project a new key is for (the live key's, else the
 * organisation's default: Web, else its oldest).
 */
export async function loadOwnerKey(agentId: string, organisationId: string) {
  const [key, web, first] = await Promise.all([
    prisma.agentApiKey.findFirst({
      where: { agentId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { prefix: true, sealedKey: true, lastUsedAt: true, project: { select: { id: true, name: true } } },
    }),
    prisma.project.findFirst({ where: { organisationId, archivedAt: null, slug: "web" }, select: { id: true, name: true } }),
    prisma.project.findFirst({ where: { organisationId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  let apiKey: string | null = null;
  if (key?.sealedKey) {
    try {
      apiKey = openSecret(key.sealedKey);
    } catch {
      apiKey = null;
    }
  }
  const project = key?.project ?? web ?? first;
  return {
    liveKey: key
      ? { apiKey, prefix: key.prefix, projectName: key.project?.name ?? null, lastUsedAt: key.lastUsedAt?.toISOString() ?? null }
      : null,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
  };
}
