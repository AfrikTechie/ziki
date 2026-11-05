import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Which agents are public on Ziki (#agent-profile): not revoked, and with a
 * set-up profile (a tagline, an About me and at least one skill). One rule for
 * the /agents directory, the sitemap and whether a profile may be indexed.
 */
export const LISTED_AGENT_CONDITIONS: Prisma.AgentWhereInput[] = [
  { revokedAt: null },
  { tagline: { not: null } },
  { NOT: { tagline: "" } },
  { about: { not: null } },
  { NOT: { about: "" } },
  { skills: { some: {} } },
];

export const listedAgentWhere: Prisma.AgentWhereInput = { AND: LISTED_AGENT_CONDITIONS };

/** Whether one agent is listed: the same rule, for an agent already loaded. */
export function isListedAgent(agent: {
  revokedAt: Date | null;
  tagline: string | null;
  about: string | null;
  skillCount: number;
}): boolean {
  return !agent.revokedAt && Boolean(agent.tagline?.trim()) && Boolean(agent.about?.trim()) && agent.skillCount > 0;
}

export type DirectoryTag = { slug: string; name: string; agents: number };

/**
 * The skill tags listed agents have: one per slug across every workspace (each
 * workspace keeps its own tags), with how many listed agents have it, most first.
 */
export async function directoryTags(): Promise<DirectoryTag[]> {
  const tags = await prisma.skillTag.findMany({
    where: { skills: { some: { agent: listedAgentWhere } } },
    select: { slug: true, name: true, _count: { select: { skills: { where: { agent: listedAgentWhere } } } } },
  });
  const bySlug = new Map<string, DirectoryTag>();
  for (const tag of tags) {
    const seen = bySlug.get(tag.slug);
    if (seen) seen.agents += tag._count.skills;
    else bySlug.set(tag.slug, { slug: tag.slug, name: tag.name, agents: tag._count.skills });
  }
  return [...bySlug.values()].sort((a, b) => b.agents - a.agents || a.name.localeCompare(b.name));
}

/** One skill's display name and how many listed agents have it; null when no listed agent does. */
export async function directoryTag(slug: string): Promise<DirectoryTag | null> {
  const tags = await prisma.skillTag.findMany({
    where: { slug, skills: { some: { agent: listedAgentWhere } } },
    select: { name: true, _count: { select: { skills: { where: { agent: listedAgentWhere } } } } },
  });
  if (!tags.length) return null;
  return { slug, name: tags[0].name, agents: tags.reduce((sum, tag) => sum + tag._count.skills, 0) };
}
