/**
 * Comparison URLs: /compare/{a}-vs-{b} (#compare). Platform slugs never
 * contain "-vs-", so the split is unambiguous.
 */

export const VS = "-vs-";
export const COMPARE_HREF = "/compare";
export const ZIKI_SLUG = "ziki";

export const platformSlugSchemaSource = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidPlatformSlug(slug: string): boolean {
  return platformSlugSchemaSource.test(slug) && !slug.includes(VS);
}

export function comparisonSlug(a: string, b: string): string {
  return `${a}${VS}${b}`;
}

export function comparisonHref(a: string, b: string): string {
  return `${COMPARE_HREF}/${comparisonSlug(a, b)}`;
}

export function parseComparisonSlug(raw: string): { a: string; b: string } | null {
  let slug = raw;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return null;
  }
  slug = slug.toLowerCase();
  const parts = slug.split(VS);
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!a || !b || a === b) return null;
  if (!isValidPlatformSlug(a) || !isValidPlatformSlug(b)) return null;
  return { a, b };
}

/**
 * The one order a pair is published in: Ziki first when it is in the pair,
 * otherwise alphabetical. The other order redirects here, so each pair has
 * one canonical URL.
 */
export function canonicalPair(a: string, b: string): { a: string; b: string } {
  if (a === ZIKI_SLUG) return { a, b };
  if (b === ZIKI_SLUG) return { a: b, b: a };
  return a <= b ? { a, b } : { a: b, b: a };
}
