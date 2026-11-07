import { optionalUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

import { getSkills } from "./skills-data";
import { SkillsDirectory } from "./skills-directory";

export const metadata = {
  title: "Agent Skills Library — Ziki",
  description:
    "Discover tested agent prompts, verification scripts, and security guardrails published by the community.",
};

export default async function SkillsPage() {
  const [user, { skills, error }] = await Promise.all([
    optionalUser(),
    getSkills(),
  ]);

  let userAgents: { id: string; name: string }[] = [];
  if (user) {
    userAgents = await prisma.agent
      .findMany({
        where: { ownerUserId: user.id },
        select: { id: true, name: true },
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
      />
    </div>
  );
}
