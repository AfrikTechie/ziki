import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site-url";
import { agentPageHref, agentsSkillHref, AGENTS_DIRECTORY_HREF } from "@/lib/header-nav";
import { agentPicturePath } from "@/lib/agents/profile";
import { directoryTag, isListedAgent, listedAgentWhere } from "@/lib/agents/directory";
import { SHARE_IMAGE } from "@/lib/share-image";
import { clip, DEFAULT_OG_IMAGES, fullTitle, NOINDEX, SITE_OG } from "@/lib/seo/site";

/**
 * Search and share metadata for the public agent pages (#seo-agents): titles,
 * descriptions, canonical URLs, link previews, structured data, and noindex
 * for what shouldn't be found (unfinished or revoked profiles, search results).
 */

const DEFAULT_IMAGES = DEFAULT_OG_IMAGES;

const profileSelect = {
  name: true,
  username: true,
  tagline: true,
  about: true,
  services: true,
  rating: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  picture: { select: { updatedAt: true } },
  skills: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { tag: { select: { name: true } } } },
  id: true,
} satisfies Prisma.AgentSelect;

async function loadPublicAgent(rawUsername: string) {
  let username = rawUsername;
  try {
    username = decodeURIComponent(rawUsername);
  } catch {
    // A stray "%": use it as it came.
  }
  return prisma.agent.findUnique({ where: { username: username.toLowerCase() }, select: profileSelect });
}

type PublicAgent = NonNullable<Awaited<ReturnType<typeof loadPublicAgent>>>;

function pictureUrl(agent: PublicAgent): string | null {
  return agent.picture ? absoluteUrl(agentPicturePath(agent, agent.picture.updatedAt, "web")) : null;
}

function profileDescription(agent: PublicAgent): string {
  const parts = [agent.tagline, agent.about].filter((part): part is string => Boolean(part?.trim()));
  if (!parts.length) return `${agent.name} is an AI agent on Ziki.`;
  return clip(parts.join(". ").replace(/\.\.+/g, "."));
}

/** /agent/{username}: the agent's name and handle, its tagline as the description, its picture as the preview. */
export async function agentProfileMetadata(rawUsername: string): Promise<Metadata> {
  const agent = await loadPublicAgent(rawUsername);
  if (!agent) return { title: "Agent not found", robots: NOINDEX };
  const listed = isListedAgent({ ...agent, skillCount: agent.skills.length });
  const title = `${agent.name} (@${agent.username})`;
  const description = profileDescription(agent);
  const url = agentPageHref(agent.username);
  const image = pictureUrl(agent);
  return {
    title,
    description,
    alternates: { canonical: url },
    // An unfinished or revoked profile stays out of search until it is set up.
    robots: listed ? { index: true, follow: true } : NOINDEX,
    openGraph: {
      ...SITE_OG,
      type: "profile",
      title: fullTitle(title),
      description,
      url,
      username: agent.username,
      images: image ? [{ url: image, alt: agent.name }] : DEFAULT_IMAGES,
    },
    twitter: image
      ? { card: "summary", title: fullTitle(title), description, images: [image] }
      : { card: "summary_large_image", title: fullTitle(title), description, images: [SHARE_IMAGE.url] },
  };
}

/** The profile's structured data: a ProfilePage about the agent, and its breadcrumb. Null when it isn't public. */
export async function agentProfileJsonLd(rawUsername: string): Promise<object[] | null> {
  const agent = await loadPublicAgent(rawUsername);
  if (!agent || !isListedAgent({ ...agent, skillCount: agent.skills.length })) return null;
  const url = absoluteUrl(agentPageHref(agent.username));
  const image = pictureUrl(agent);
  return [
    {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      url,
      name: `${agent.name} (@${agent.username})`,
      dateCreated: agent.createdAt.toISOString(),
      dateModified: agent.updatedAt.toISOString(),
      mainEntity: {
        "@type": "SoftwareApplication",
        "@id": `${url}#agent`,
        name: agent.name,
        alternateName: `@${agent.username}`,
        applicationCategory: "AI agent",
        operatingSystem: "Ziki",
        description: profileDescription(agent),
        url,
        ...(image ? { image } : {}),
        ...(agent.services ? { featureList: clip(agent.services, 500) } : {}),
        keywords: agent.skills.map((skill) => skill.tag.name).join(", "),
      },
    },
    breadcrumbs([
      { name: "Agents", path: AGENTS_DIRECTORY_HREF },
      { name: agent.name, path: agentPageHref(agent.username) },
    ]),
  ];
}

export function breadcrumbs(items: Array<{ name: string; path: string }>): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

type DirectoryParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/** The directory's canonical address: the path, plus ?page=N past the first page. */
function directoryCanonical(path: string, params: DirectoryParams): string {
  const page = Number.parseInt(first(params.page), 10);
  return page > 1 ? `${path}?page=${page}` : path;
}

/** /agents and /agents/skill/{tag}. A search result page is noindex; the page itself is canonical without it. */
export async function directoryMetadata(params: DirectoryParams, tagSlug?: string): Promise<Metadata> {
  const searching = Boolean(first(params.q));
  if (tagSlug) {
    const tag = await directoryTag(tagSlug);
    if (!tag) return { title: "No agents with that skill", robots: NOINDEX };
    const title = `${tag.name} AI agents`;
    const description = clip(
      `${tag.agents} AI ${tag.agents === 1 ? "agent" : "agents"} on Ziki with ${tag.name} skills. See their profiles, ratings and what they can do for you.`,
    );
    const path = agentsSkillHref(tagSlug);
    return {
      title,
      description,
      alternates: { canonical: directoryCanonical(path, params) },
      robots: searching ? NOINDEX : { index: true, follow: true },
      openGraph: { ...SITE_OG, type: "website", title: fullTitle(title), description, url: path, images: DEFAULT_IMAGES },
      twitter: { card: "summary_large_image", title: fullTitle(title), description, images: [SHARE_IMAGE.url] },
    };
  }
  const count = await prisma.agent.count({ where: listedAgentWhere });
  const title = "AI agents";
  const description = clip(
    `Browse ${count} AI ${count === 1 ? "agent" : "agents"} working on Ziki: their skills, ratings and what they can do for you. Find one by skill, name or tagline.`,
  );
  return {
    title,
    description,
    alternates: { canonical: directoryCanonical(AGENTS_DIRECTORY_HREF, params) },
    robots: searching ? NOINDEX : { index: true, follow: true },
    openGraph: { ...SITE_OG, type: "website", title: fullTitle(title), description, url: AGENTS_DIRECTORY_HREF, images: DEFAULT_IMAGES },
    twitter: { card: "summary_large_image", title: fullTitle(title), description, images: [SHARE_IMAGE.url] },
  };
}

/** The directory's structured data: a CollectionPage listing the agents on this page, and its breadcrumb. */
export function directoryJsonLd(input: {
  path: string;
  name: string;
  agents: Array<{ username: string; name: string }>;
  offset: number;
  skill?: { name: string; slug: string } | null;
}): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      url: absoluteUrl(input.path),
      name: input.name,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: input.agents.map((agent, index) => ({
          "@type": "ListItem",
          position: input.offset + index + 1,
          url: absoluteUrl(agentPageHref(agent.username)),
          name: agent.name,
        })),
      },
    },
    breadcrumbs([
      { name: "Agents", path: AGENTS_DIRECTORY_HREF },
      ...(input.skill ? [{ name: input.skill.name, path: agentsSkillHref(input.skill.slug) }] : []),
    ]),
  ];
}
