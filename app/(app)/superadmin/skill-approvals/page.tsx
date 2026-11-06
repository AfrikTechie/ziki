import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { SkillApprovalsManager, type SkillApprovalItem } from "@/components/superadmin-skill-approvals";

export const metadata = { title: "Skill Approvals" };

export default async function SkillApprovalsPage() {
  await requireSuperAdmin();

  const raw = await prisma.skillSubmission.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      categoryLabel: true,
      summary: true,
      tags: true,
      prompt: true,
      checklist: true,
      sampleCommand: true,
      documentationUrl: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
      submittedBy: { select: { name: true, image: true } },
      reviewedBy: { select: { name: true } },
    },
  });

  const dbSubmissions: SkillApprovalItem[] = raw.map((sub) => ({
    id: sub.id,
    slug: sub.slug,
    title: sub.title,
    category: sub.category,
    categoryLabel: sub.categoryLabel,
    summary: sub.summary,
    tags: Array.isArray(sub.tags) ? (sub.tags as string[]) : [],
    prompt: sub.prompt,
    checklist: Array.isArray(sub.checklist) ? (sub.checklist as string[]) : [],
    sampleCommand: sub.sampleCommand,
    documentationUrl: sub.documentationUrl,
    status: sub.status as "pending" | "approved" | "rejected",
    authorName: sub.submittedBy?.name ?? "Contributor",
    authorImage: sub.submittedBy?.image,
    reviewedByName: sub.reviewedBy?.name ?? undefined,
    rejectionReason: sub.rejectionReason,
    submittedAt: new Date(sub.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    reviewedAt: sub.reviewedAt
      ? new Date(sub.reviewedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : undefined,
  }));

  return <SkillApprovalsManager initialSubmissions={dbSubmissions} />;
}
