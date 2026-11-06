import { z } from "zod";
import {
  COMPARE_CATEGORY_VALUES,
  COMPARE_DIMENSIONS,
  FEATURE_STATUSES,
  isFeatureStatus,
  type FeatureMap,
} from "./catalog";
import { isValidPlatformSlug } from "./slug";
import { comparisonContentSchema, type ComparisonContent } from "./content";

/**
 * Parsing and checking for the /superadmin/compare forms (#compare). The
 * accuracy rules of the directory live here, where an admin can't skip them:
 * a verified answer needs a source and a date, and "not available" needs a
 * note too, so no competitor is ever marked as lacking something on a hunch.
 */

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

const text = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
export const lines = (value: string) => value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const flag = (fd: FormData, name: string) => fd.get(name) === "on";

const httpUrl = (label: string) =>
  z.string().trim().url(`${label} must be a full web address starting with https://.`).refine((u) => /^https?:\/\//.test(u), `${label} must start with http:// or https://.`);

const logoPath = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\/[A-Za-z0-9/_.-]+$/.test(v), "The logo must be a path on this site such as /compare/logos/name.svg, or empty.");

export type PlatformInput = {
  slug: string;
  name: string;
  category: (typeof COMPARE_CATEGORY_VALUES)[number];
  websiteUrl: string;
  logoUrl: string | null;
  description: string;
  useCases: string[];
  strengths: string[];
  limitations: string[];
  pricingSummary: string | null;
  sourceUrls: string[];
  features: FeatureMap;
  lastVerifiedAt: Date | null;
  popular: boolean;
  published: boolean;
  sortOrder: number;
};

const platformSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidPlatformSlug, "The slug is lowercase letters, digits and dashes, up to 40 characters, and can't contain “-vs-”."),
  name: z.string().trim().min(1, "Name the platform.").max(80),
  category: z.enum(COMPARE_CATEGORY_VALUES, { message: "Pick a category." }),
  websiteUrl: httpUrl("The website"),
  logoUrl: logoPath,
  description: z.string().trim().min(10, "Describe what the platform is in a sentence.").max(400),
  pricingSummary: z.string().trim().max(400),
});

export function parsePlatformForm(fd: FormData): ParseResult<PlatformInput> {
  const base = platformSchema.safeParse({
    slug: text(fd, "slug"),
    name: text(fd, "name"),
    category: text(fd, "category"),
    websiteUrl: text(fd, "websiteUrl"),
    logoUrl: text(fd, "logoUrl"),
    description: text(fd, "description"),
    pricingSummary: text(fd, "pricingSummary"),
  });
  if (!base.success) return { ok: false, error: base.error.issues[0]?.message ?? "Check the form." };

  const sourceUrls = lines(text(fd, "sourceUrls"));
  for (const url of sourceUrls) {
    if (!httpUrl("Each source").safeParse(url).success) return { ok: false, error: `“${url}” isn't a full web address. Put one source per line.` };
  }

  const dateRaw = text(fd, "lastVerifiedAt");
  let lastVerifiedAt: Date | null = null;
  if (dateRaw) {
    lastVerifiedAt = new Date(`${dateRaw}T00:00:00.000Z`);
    if (Number.isNaN(lastVerifiedAt.getTime())) return { ok: false, error: "The verified date isn't a valid date." };
  }

  const features: FeatureMap = {};
  for (const dimension of COMPARE_DIMENSIONS) {
    const status = text(fd, `feature.${dimension.key}.status`) || "not_verified";
    if (!isFeatureStatus(status)) return { ok: false, error: `“${status}” isn't a status for ${dimension.label}.` };
    const note = text(fd, `feature.${dimension.key}.note`);
    const sourceUrl = text(fd, `feature.${dimension.key}.sourceUrl`);
    if (sourceUrl && !httpUrl("The source").safeParse(sourceUrl).success) return { ok: false, error: `${dimension.label}: the source must be a full web address.` };
    if (note.length > 500) return { ok: false, error: `${dimension.label}: keep the note under 500 characters.` };
    if (status !== "not_verified") {
      if (!sourceUrl) return { ok: false, error: `${dimension.label}: a verified answer needs a source. Record where you checked it, or set it to “Not verified”.` };
      if (status === "not_available" && !note) return { ok: false, error: `${dimension.label}: say what you checked before marking something “Not available”.` };
    }
    if (status === "not_verified" && !note && !sourceUrl) continue;
    features[dimension.key] = { status, ...(note ? { note } : {}), ...(sourceUrl ? { sourceUrl } : {}) };
  }

  const anyVerified = Object.values(features).some((f) => f.status !== "not_verified");
  if (anyVerified && !lastVerifiedAt) return { ok: false, error: "Record the date you last verified these answers." };

  const sortOrder = Number.parseInt(text(fd, "sortOrder") || "0", 10);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return { ok: false, error: "The order is a whole number from 0 to 9999." };

  return {
    ok: true,
    data: {
      ...base.data,
      logoUrl: base.data.logoUrl || null,
      pricingSummary: base.data.pricingSummary || null,
      useCases: lines(text(fd, "useCases")).slice(0, 10),
      strengths: lines(text(fd, "strengths")).slice(0, 10),
      limitations: lines(text(fd, "limitations")).slice(0, 10),
      sourceUrls: sourceUrls.slice(0, 20),
      features,
      lastVerifiedAt,
      popular: flag(fd, "popular"),
      published: flag(fd, "published"),
      sortOrder,
    },
  };
}

export type ComparisonInput = {
  platformAId: string;
  platformBId: string;
  title: string;
  summary: string | null;
  content: ComparisonContent;
  seoTitle: string | null;
  seoDescription: string | null;
  popular: boolean;
  published: boolean;
};

/** "heading | text about A | text about B", one per line. */
export function parseDetails(value: string): ParseResult<NonNullable<ComparisonContent["details"]>> {
  const out: NonNullable<ComparisonContent["details"]> = [];
  for (const line of lines(value)) {
    const [heading, a, b] = line.split("|").map((p) => p.trim());
    if (!heading || !a || !b) return { ok: false, error: `Detail “${line.slice(0, 40)}”: write it as heading | about the first | about the second.` };
    out.push({ heading, a, b });
  }
  return { ok: true, data: out };
}

/** "use case | a, b or either | optional note", one per line. */
export function parseRecommendations(value: string): ParseResult<NonNullable<ComparisonContent["recommendations"]>> {
  const out: NonNullable<ComparisonContent["recommendations"]> = [];
  for (const line of lines(value)) {
    const [useCase, pick, note] = line.split("|").map((p) => p.trim());
    const choice = (pick ?? "").toLowerCase();
    if (!useCase || !["a", "b", "either"].includes(choice)) return { ok: false, error: `Recommendation “${line.slice(0, 40)}”: write it as use case | a, b or either | optional note.` };
    out.push({ useCase, pick: choice as "a" | "b" | "either", ...(note ? { note } : {}) });
  }
  return { ok: true, data: out };
}

export function parseComparisonForm(fd: FormData): ParseResult<ComparisonInput> {
  const platformAId = text(fd, "platformAId");
  const platformBId = text(fd, "platformBId");
  if (!platformAId || !platformBId) return { ok: false, error: "Pick both platforms." };
  if (platformAId === platformBId) return { ok: false, error: "A platform can't be compared with itself." };
  const title = text(fd, "title");
  if (!title) return { ok: false, error: "Give the comparison a title." };

  const details = parseDetails(text(fd, "details"));
  if (!details.ok) return details;
  const recommendations = parseRecommendations(text(fd, "recommendations"));
  if (!recommendations.ok) return recommendations;

  const content = comparisonContentSchema.safeParse({
    intro: text(fd, "intro") || undefined,
    details: details.data,
    strengthsA: lines(text(fd, "strengthsA")),
    limitationsA: lines(text(fd, "limitationsA")),
    strengthsB: lines(text(fd, "strengthsB")),
    limitationsB: lines(text(fd, "limitationsB")),
    recommendations: recommendations.data,
  });
  if (!content.success) return { ok: false, error: content.error.issues[0]?.message ?? "Check the comparison text." };

  const summary = text(fd, "summary");
  const seoTitle = text(fd, "seoTitle");
  const seoDescription = text(fd, "seoDescription");
  if (summary.length > 300) return { ok: false, error: "Keep the summary under 300 characters." };
  if (seoTitle.length > 70) return { ok: false, error: "Keep the SEO title under 70 characters." };
  if (seoDescription.length > 170) return { ok: false, error: "Keep the SEO description under 170 characters." };

  return {
    ok: true,
    data: {
      platformAId,
      platformBId,
      title,
      summary: summary || null,
      content: content.data,
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
      popular: flag(fd, "popular"),
      published: flag(fd, "published"),
    },
  };
}

export const STATUS_OPTIONS = FEATURE_STATUSES;
