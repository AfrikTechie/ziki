import { categoryShortLabel, featureOf, sharedDimensions, type CompareDimension, type FeatureEntry } from "./catalog";
import { readComparisonContent, type ComparisonContent } from "./content";
import { comparisonSlug, canonicalPair } from "./slug";

export type PlatformData = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string;
  category: string;
  description: string;
  useCases: string[];
  strengths: string[];
  limitations: string[];
  pricingSummary: string | null;
  features: unknown;
  sourceUrls: string[];
  isZiki: boolean;
  popular: boolean;
  lastVerifiedAt: Date | null;
  updatedAt: Date;
};

export type CuratedComparison = {
  title: string;
  summary: string | null;
  content: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: Date;
  published: boolean;
};

export type ComparisonRow = { dimension: CompareDimension; a: FeatureEntry; b: FeatureEntry };

export type Recommendation = { useCase: string; pick: "a" | "b" | "either"; note?: string };

export type BuiltComparison = {
  slug: string;
  title: string;
  summary: string;
  intro: string;
  /** The hand-written introduction, when there is one. */
  customIntro: string | null;
  /** Direct rivals share a category; otherwise the pair is compared only where the products overlap. */
  relationship: "direct" | "adjacent";
  relationshipNote: string;
  rows: ComparisonRow[];
  details: { heading: string; a: string; b: string }[];
  strengthsA: string[];
  limitationsA: string[];
  strengthsB: string[];
  limitationsB: string[];
  recommendations: Recommendation[];
  /** How many rows each platform has a checked answer for. */
  verifiedA: number;
  verifiedB: number;
  curated: boolean;
  updatedAt: Date;
  seoTitle: string;
  seoDescription: string;
  /** Ziki pairs and hand-written pairs are indexed; an arbitrary pair of competitors is not. */
  indexable: boolean;
};

export function clip(text: string, max = 158): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

function orEmpty<T>(value: T[] | undefined, fallback: T[]): T[] {
  return value && value.length > 0 ? value : fallback;
}

function deriveRecommendations(a: PlatformData, b: PlatformData): Recommendation[] {
  return [
    ...a.useCases.map((useCase) => ({ useCase, pick: "a" as const })),
    ...b.useCases.map((useCase) => ({ useCase, pick: "b" as const })),
  ];
}

/** Per-row notes written for either platform become the detail section when nobody has written one. */
function deriveDetails(rows: ComparisonRow[]): { heading: string; a: string; b: string }[] {
  return rows
    .filter((row) => row.a.note || row.b.note)
    .map((row) => ({
      heading: row.dimension.label,
      a: row.a.note ?? "Not verified yet.",
      b: row.b.note ?? "Not verified yet.",
    }));
}

export function buildComparison(
  platformA: PlatformData,
  platformB: PlatformData,
  curated: CuratedComparison | null,
): BuiltComparison {
  // Show the pair in its canonical order, whichever order the URL used.
  const pair = canonicalPair(platformA.slug, platformB.slug);
  const [a, b] = pair.a === platformA.slug ? [platformA, platformB] : [platformB, platformA];
  const live = curated?.published ? curated : null;
  const content: ComparisonContent = live ? readComparisonContent(live.content) : {};

  const rows = sharedDimensions(a.category, b.category).map((dimension) => ({
    dimension,
    a: featureOf(a.features, dimension.key),
    b: featureOf(b.features, dimension.key),
  }));

  const direct = a.category === b.category;
  const relationshipNote = direct
    ? `${a.name} and ${b.name} are both ${categoryShortLabel(a.category).toLowerCase()}s, so they are compared head to head.`
    : `${a.name} is ${articleFor(categoryShortLabel(a.category))} and ${b.name} is ${articleFor(categoryShortLabel(b.category))}. They solve different problems, so only the capabilities that genuinely overlap are compared.`;

  const title = live?.title || `${a.name} vs ${b.name}`;
  const summary =
    live?.summary ||
    `How ${a.name} and ${b.name} compare on ${rows.length} capabilities, with what has and hasn't been verified.`;
  const details = content.details && content.details.length > 0 ? content.details : deriveDetails(rows);
  const updatedAt = live?.updatedAt ?? newest(a.updatedAt, b.updatedAt);

  return {
    slug: comparisonSlug(a.slug, b.slug),
    title,
    summary,
    customIntro: content.intro?.trim() || null,
    intro: content.intro || `${a.name}: ${a.description} ${b.name}: ${b.description}`,
    relationship: direct ? "direct" : "adjacent",
    relationshipNote,
    rows,
    details,
    strengthsA: orEmpty(content.strengthsA, a.strengths),
    limitationsA: orEmpty(content.limitationsA, a.limitations),
    strengthsB: orEmpty(content.strengthsB, b.strengths),
    limitationsB: orEmpty(content.limitationsB, b.limitations),
    recommendations: orEmpty(content.recommendations, deriveRecommendations(a, b)),
    verifiedA: rows.filter((r) => r.a.status !== "not_verified").length,
    verifiedB: rows.filter((r) => r.b.status !== "not_verified").length,
    curated: Boolean(live),
    updatedAt,
    seoTitle: live?.seoTitle || `${a.name} vs ${b.name}: features, use cases and differences`,
    seoDescription: clip(
      live?.seoDescription || `${title}. ${summary} ${direct ? "Direct alternatives." : "Different product types, compared where they overlap."}`,
    ),
    indexable: Boolean(live) || a.isZiki || b.isZiki,
  };
}

function articleFor(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

function newest(x: Date, y: Date): Date {
  return x.getTime() >= y.getTime() ? x : y;
}

/** The card text for a pair on the directory. */
export function cardSummary(a: PlatformData, b: PlatformData, curated: CuratedComparison | null): string {
  if (curated?.published && curated.summary) return curated.summary;
  return a.category === b.category
    ? `Head to head: ${a.name} and ${b.name} as ${categoryShortLabel(a.category).toLowerCase()}s.`
    : `${a.name} (${categoryShortLabel(a.category).toLowerCase()}) and ${b.name} (${categoryShortLabel(b.category).toLowerCase()}), compared where they overlap.`;
}
