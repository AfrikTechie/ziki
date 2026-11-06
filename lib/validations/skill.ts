import { z } from "zod";

export const SKILL_CATEGORIES = [
  "testing",
  "security",
  "design",
  "backend",
  "marketing",
  "general",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  testing: "Testing & Test Runners",
  security: "Security & Guardrails",
  design: "UI, UX & Design Systems",
  backend: "Database & Backend",
  marketing: "SEO & Growth",
  general: "General Tooling",
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export const createSubmissionSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(120, "Title cannot exceed 120 characters"),
  category: z.enum(SKILL_CATEGORIES, { message: "Invalid skill category" }),
  summary: z
    .string()
    .trim()
    .min(10, "Summary must be at least 10 characters")
    .max(400, "Summary cannot exceed 400 characters"),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Tag cannot be empty")
        .max(30, "Tag cannot exceed 30 characters")
        .regex(/^[a-zA-Z0-9_-]+$/, "Tags may only contain letters, numbers, hyphens, and underscores")
    )
    .max(10, "Maximum of 10 tags allowed"),
  prompt: z
    .string()
    .trim()
    .min(10, "Prompt must be at least 10 characters")
    .max(10_000, "Prompt cannot exceed 10,000 characters"),
  checklist: z
    .array(
      z.string().trim().min(1, "Checklist item cannot be empty").max(200, "Checklist item cannot exceed 200 characters")
    )
    .max(15, "Maximum of 15 checklist items allowed")
    .optional()
    .default([]),
  sampleCommand: z
    .string()
    .trim()
    .max(160, "Sample command cannot exceed 160 characters")
    .optional()
    .nullable(),
  documentationUrl: z
    .string()
    .trim()
    .max(300, "Documentation URL cannot exceed 300 characters")
    .regex(/^https?:\/\/.+/i, "Documentation URL must start with http:// or https://")
    .optional()
    .nullable(),
  revisionOfId: z.string().optional().nullable(),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
