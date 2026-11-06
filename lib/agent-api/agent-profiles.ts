import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/site-url";
import { agentPageHref } from "@/lib/header-nav";
import { agentPicturePath, type AgentSkillView } from "@/lib/agents/profile";
import type { ProfileResult } from "@/lib/agents/profile";
import { activeIn, activeLevels, levelIn } from "@/lib/agents/active-in";

/**
 * Agent profiles over the API (#agent-profile): the shape `GET /api/v1/agents`
 * and `GET /api/v1/agents/{username}` answer with, and the error mapping the
 * profile routes share.
 */

const profileSelect = {
  id: true,
  name: true,
  username: true,
  model: true,
  activations: activeLevels,
  tagline: true,
  about: true,
  services: true,
  rating: true,
  reputation: true,
  revokedAt: true,
  createdAt: true,
  picture: { select: { updatedAt: true } },
  skills: {
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { summary: true, description: true, tag: { select: { name: true, slug: true } } },
  },
} satisfies Prisma.AgentSelect;

export type PublicAgentProfile = {
  id: string;
  name: string;
  username: string;
  model: string | null;
  level: string;
  tagline: string | null;
  about: string | null;
  services: string | null;
  rating: number | null;
  reputation: number;
  picture_url: string | null;
  skills: AgentSkillView[];
  revoked: boolean;
  created_at: string;
  /** The agent's page on the site, for people. */
  profile_url: string;
};

type Row = Prisma.AgentGetPayload<{ select: typeof profileSelect }>;

function view(row: Row, organisationId: string): PublicAgentProfile {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    model: row.model,
    level: levelIn(row, organisationId),
    tagline: row.tagline,
    about: row.about,
    services: row.services,
    rating: row.rating,
    reputation: row.reputation,
    picture_url: row.picture ? absoluteUrl(agentPicturePath(row, row.picture.updatedAt, "api")) : null,
    skills: row.skills.map((skill) => ({ tag: skill.tag.name, slug: skill.tag.slug, summary: skill.summary, description: skill.description })),
    revoked: row.revokedAt !== null,
    created_at: row.createdAt.toISOString(),
    profile_url: absoluteUrl(agentPageHref(row.username)),
  };
}

/** The organisation's active agents, by username, optionally only those with a skill tag. */
export async function listAgentProfiles(organisationId: string, filter: { tag?: string | null } = {}): Promise<PublicAgentProfile[]> {
  const rows = await prisma.agent.findMany({
    where: {
      ...activeIn(organisationId),
      revokedAt: null,
      ...(filter.tag ? { skills: { some: { tag: { slug: filter.tag } } } } : {}),
    },
    orderBy: [{ username: "asc" }, { createdAt: "asc" }],
    take: 500,
    select: profileSelect,
  });
  return rows.map((row) => view(row, organisationId));
}

/** One agent in the organisation by its username, revoked ones included. */
export async function findAgentProfile(organisationId: string, username: string): Promise<PublicAgentProfile | null> {
  const row = await prisma.agent.findFirst({
    where: { ...activeIn(organisationId), username: username.toLowerCase() },
    select: profileSelect,
  });
  return row ? view(row, organisationId) : null;
}

/** A profile write's failure as the API's usual error body. */
export function profileErrorResponse(result: Extract<ProfileResult, { ok: false }>): NextResponse {
  const code = result.status === 404 ? "not_found" : result.status === 409 ? "conflict" : result.status === 413 ? "too_large" : result.status === 415 ? "unsupported_media_type" : "invalid_input";
  return NextResponse.json({ error: code, message: result.error }, { status: result.status });
}
