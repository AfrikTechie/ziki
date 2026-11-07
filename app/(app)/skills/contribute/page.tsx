import { requireUser } from "@/lib/auth-helpers";
import { NOINDEX } from "@/lib/seo/site";
import { prisma } from "@/lib/prisma";
import { EarnSkillsPortal, type ContributorSubmission } from "./earn-skills-portal";
import { type SkillCategory } from "@/app/(app)/skills/skills-data";

// Signed in only, so it is kept out of search results (#seo-pages).
export const metadata = {
  title: "Contribute skills",
  description:
    "Contribute AI agent skills, test harnesses, and security linters to Ziki. Submit skills for maintainer review and community adoption.",
  robots: NOINDEX,
};

export default async function EarnSkillsPage() {
  const user = await requireUser();

  let userSubmissions: ContributorSubmission[] = [];
  let loadError: string | null = null;
  try {
    const raw = await prisma.skillSubmission.findMany({
      where: { submittedById: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        category: true,
        categoryLabel: true,
        summary: true,
        status: true,
        tags: true,
        prompt: true,
        checklist: true,
        sampleCommand: true,
        documentationUrl: true,
        rejectionReason: true,
        createdAt: true,
      },
    });

    userSubmissions = raw.map((sub) => ({
      id: sub.id,
      title: sub.title,
      category: sub.category as SkillCategory,
      categoryLabel: sub.categoryLabel,
      summary: sub.summary,
      status: (sub.status === "rejected" ? "changes_requested" : sub.status) as
        | "pending"
        | "approved"
        | "changes_requested",
      submittedAt: new Date(sub.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      tags: Array.isArray(sub.tags) ? (sub.tags as string[]) : [],
      prompt: sub.prompt,
      checklist: Array.isArray(sub.checklist) ? (sub.checklist as string[]) : [],
      sampleCommand: sub.sampleCommand ?? undefined,
      docUrl: sub.documentationUrl ?? undefined,
      maintainerFeedback: sub.rejectionReason ?? undefined,
    }));
  } catch (err) {
    console.error("[earn-skills] failed to fetch user submissions:", err);
    loadError = "Unable to load submissions from the database. Please try again later.";
  }

  return (
    <div className="mx-auto max-w-6xl py-4 space-y-8">
      <EarnSkillsPortal
        user={{
          id: user.id,
          name: user.name || "Contributor",
          email: user.email || "",
        }}
        initialSubmissions={userSubmissions}
        loadError={loadError}
      />
    </div>
  );
}
