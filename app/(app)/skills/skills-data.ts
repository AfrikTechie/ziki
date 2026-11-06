import { prisma } from "@/lib/prisma";

export type SkillCategory = "testing" | "security" | "design" | "backend" | "marketing" | "general";
export type SkillBadgeColor = "blue" | "emerald" | "indigo" | "pink" | "purple" | "cyan" | "amber";

export interface SkillItem {
  id: string;
  slug: string;
  title: string;
  icon: "flutter" | "shield" | "browser" | "figma" | "database" | "a11y" | "test" | "api" | "seo";
  category: SkillCategory;
  categoryLabel: string;
  badge?: string;
  badgeColor?: SkillBadgeColor;
  description: string;
  tags: string[];
  prompt: string;
  spec: {
    overview: string;
    checklist: string[];
    sampleCommand?: string | null;
    documentationUrl?: string | null;
  };
  author: {
    name: string;
    handle: string;
  };
  createdAt: string;
}

function resolveIcon(title: string, category: string): SkillItem["icon"] {
  const t = title.toLowerCase();
  const c = category.toLowerCase();
  if (t.includes("flutter")) return "flutter";
  if (c === "security" || t.includes("security") || t.includes("snare") || t.includes("guard")) return "shield";
  if (t.includes("browser") || t.includes("playwright") || t.includes("e2e")) return "browser";
  if (c === "design" || t.includes("figma") || t.includes("tailwind") || t.includes("ui")) return "figma";
  if (c === "backend" || t.includes("database") || t.includes("postgres") || t.includes("sql") || t.includes("redis")) return "database";
  if (t.includes("accessibility") || t.includes("a11y") || t.includes("wcag")) return "a11y";
  if (t.includes("seo") || c === "marketing") return "seo";
  return "test";
}

function mapSubmissionToSkill(sub: {
  id: string;
  slug: string;
  title: string;
  category: string;
  categoryLabel: string;
  summary: string;
  tags: string[];
  prompt: string;
  checklist?: string[];
  sampleCommand?: string | null;
  documentationUrl?: string | null;
  createdAt: Date;
  submittedBy?: { name: string | null } | null;
}): SkillItem {
  const authorName = sub.submittedBy?.name || "Contributor";
  const handle = "@" + authorName.toLowerCase().replace(/[^a-z0-9]/g, "");

  return {
    id: sub.id,
    slug: sub.slug || sub.id,
    title: sub.title,
    icon: resolveIcon(sub.title, sub.category),
    category: (sub.category as SkillCategory) || "general",
    categoryLabel: sub.categoryLabel || "General",
    description: sub.summary,
    tags: Array.isArray(sub.tags) ? sub.tags : [],
    prompt: sub.prompt,
    spec: {
      overview: sub.summary,
      checklist: Array.isArray(sub.checklist) ? sub.checklist : [],
      sampleCommand: sub.sampleCommand || null,
      documentationUrl: sub.documentationUrl || null,
    },
    author: {
      name: authorName,
      handle,
    },
    createdAt: sub.createdAt.toISOString(),
  };
}

export interface GetSkillsResult {
  skills: SkillItem[];
  error?: string | null;
}

export async function getSkills(): Promise<GetSkillsResult> {
  try {
    const approved = await prisma.skillSubmission.findMany({
      where: { status: "approved" },
      orderBy: { createdAt: "desc" },
      include: {
        submittedBy: { select: { name: true } },
      },
    });

    return { skills: approved.map(mapSubmissionToSkill) };
  } catch (error) {
    console.error("[skills] failed to load approved skills from db:", error);
    return {
      skills: [],
      error: "Unable to load approved skills from the database. Please try again later.",
    };
  }
}

export async function getSkillBySlug(slug: string): Promise<SkillItem | undefined> {
  const normalized = slug.trim().toLowerCase();
  try {
    const sub = await prisma.skillSubmission.findFirst({
      where: {
        OR: [{ slug: normalized }, { id: slug }],
        status: "approved",
      },
      include: {
        submittedBy: { select: { name: true } },
      },
    });

    if (!sub) return undefined;
    return mapSubmissionToSkill(sub);
  } catch (error) {
    console.error("[skills] failed to load skill by slug", error);
    return undefined;
  }
}
