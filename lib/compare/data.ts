import "server-only";
import { prisma } from "@/lib/prisma";
import { cardSummary, type CuratedComparison, type PlatformData } from "./build";
import { canonicalPair, comparisonSlug, ZIKI_SLUG } from "./slug";

const platformSelect = {
  id: true,
  slug: true,
  name: true,
  logoUrl: true,
  websiteUrl: true,
  category: true,
  description: true,
  useCases: true,
  strengths: true,
  limitations: true,
  pricingSummary: true,
  features: true,
  sourceUrls: true,
  isZiki: true,
  popular: true,
  lastVerifiedAt: true,
  updatedAt: true,
} as const;

export type ComparisonCard = {
  slug: string;
  title: string;
  description: string;
  a: PlatformData;
  b: PlatformData;
  popular: boolean;
};

/** Every platform visitors can pick, Ziki first, then by catalogue order and name. */
export async function listPublishedPlatforms(): Promise<PlatformData[]> {
  const rows = await prisma.comparePlatform.findMany({
    where: { published: true },
    orderBy: [{ isZiki: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: platformSelect,
  });
  return rows;
}

export async function findPublishedPlatform(slug: string): Promise<PlatformData | null> {
  return prisma.comparePlatform.findFirst({ where: { slug, published: true }, select: platformSelect });
}

/** The hand-written comparison for a pair, in either order, if one exists. */
export async function findCurated(aId: string, bId: string): Promise<CuratedComparison | null> {
  return prisma.comparison.findFirst({
    where: {
      OR: [
        { platformAId: aId, platformBId: bId },
        { platformAId: bId, platformBId: aId },
      ],
    },
    select: { title: true, summary: true, content: true, seoTitle: true, seoDescription: true, updatedAt: true, published: true },
  });
}

/**
 * Every comparison that has a page worth listing: Ziki against each published
 * platform (built from the platforms' own data) plus every published
 * hand-written pair. Deduplicated by canonical URL.
 */
export async function listComparisonCards(): Promise<ComparisonCard[]> {
  const [platforms, curated] = await Promise.all([
    listPublishedPlatforms(),
    prisma.comparison.findMany({
      where: { published: true, platformA: { published: true }, platformB: { published: true } },
      select: {
        title: true,
        summary: true,
        content: true,
        seoTitle: true,
        seoDescription: true,
        updatedAt: true,
        published: true,
        popular: true,
        platformAId: true,
        platformBId: true,
      },
    }),
  ]);
  const byId = new Map(platforms.map((p) => [p.id, p]));
  const cards = new Map<string, ComparisonCard>();

  const add = (x: PlatformData, y: PlatformData, over: (CuratedComparison & { popular?: boolean }) | null) => {
    const pair = canonicalPair(x.slug, y.slug);
    const slug = comparisonSlug(pair.a, pair.b);
    const [a, b] = pair.a === x.slug ? [x, y] : [y, x];
    const existing = cards.get(slug);
    const popular = Boolean(over?.popular) || Boolean(existing?.popular) || (a.isZiki ? b.popular : false);
    cards.set(slug, {
      slug,
      title: over?.published && over.title ? over.title : `${a.name} vs ${b.name}`,
      description: cardSummary(a, b, over),
      a,
      b,
      popular,
    });
  };

  const ziki = platforms.find((p) => p.slug === ZIKI_SLUG);
  if (ziki) for (const other of platforms) if (other.id !== ziki.id) add(ziki, other, null);
  for (const row of curated) {
    const x = byId.get(row.platformAId);
    const y = byId.get(row.platformBId);
    if (x && y) add(x, y, row);
  }
  return [...cards.values()];
}

/** Other comparisons worth a visit from this one: same platforms elsewhere, then same category. */
export function relatedCards(cards: ComparisonCard[], currentSlug: string, a: PlatformData, b: PlatformData, limit = 4): ComparisonCard[] {
  const score = (card: ComparisonCard) => {
    let s = 0;
    for (const p of [card.a, card.b]) {
      if (p.slug === a.slug || p.slug === b.slug) s += 2;
      if (p.category === a.category || p.category === b.category) s += 1;
    }
    return s + (card.popular ? 1 : 0);
  };
  return cards
    .filter((card) => card.slug !== currentSlug)
    .map((card) => ({ card, s: score(card) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.card.title.localeCompare(y.card.title))
    .slice(0, limit)
    .map((x) => x.card);
}
