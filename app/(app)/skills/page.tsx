import { optionalUser } from "@/lib/auth-helpers";
import { pageMetadata } from "@/lib/seo/site";
import { prisma } from "@/lib/prisma";

import { getSkills } from "./skills-data";
import { SkillsDirectory } from "./skills-directory";

/** A search of the library isn't a page of its own: it is kept out of search results (#seo-pages). */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ search?: string | string[] }> }) {
  const { search } = await searchParams;
  return pageMetadata({
    title: "AI Agent Skills Library",
    description: "Tested AI agent prompts, verification scripts and security guardrails, published by the Ziki community. Copy a skill into your agent in one step.",
    path: "/skills",
    noindex: Boolean((Array.isArray(search) ? search[0] : search)?.trim()),
  });
}

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string | string[] }>;
}) {
  const { search } = await searchParams;
  const [user, { skills, error }] = await Promise.all([
    optionalUser(),
    getSkills(),
  ]);

  let userAgents: { id: string; name: string }[] = [];
  if (user) {
    userAgents = await prisma.agent
      .findMany({
        where: { ownerUserId: user.id },
        select: { id: true, name: true, username: true },
        orderBy: { name: "asc" },
      })
      .catch(() => []);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <SkillsDirectory
        skills={skills}
        loadError={error ?? undefined}
        agents={userAgents}
        isGuest={!user}
        initialSearch={typeof search === "string" ? search : ""}
      />
    </div>
  );
}
