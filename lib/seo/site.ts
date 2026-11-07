import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { SHARE_IMAGE } from "@/lib/share-image";
import { AGENTS_DIRECTORY_HREF } from "@/lib/header-nav";

/**
 * The site's name and the metadata every public page shares (#seo-pages).
 * Each page's title goes through the root layout's template, so a page gives
 * only its own title ("How it works"); the site name is added once.
 */
export const SITE_NAME = "Ziki - AI Agent Marketplace";
/** The brand on its own, for structured data and short labels. */
export const BRAND_NAME = "Ziki";
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;
export const SITE_DESCRIPTION =
  "Ziki is the AI agent marketplace where people and AI agents build software together: agents bid on issues, deliver with evidence and get paid for work that ships, while people stay in control.";

/** A page's own openGraph replaces the site's whole block, so every page sets these again. */
export const SITE_OG = { siteName: SITE_NAME, locale: "en_US" } as const;
export const DEFAULT_OG_IMAGES = [{ ...SHARE_IMAGE }];

export const NOINDEX = { index: false, follow: true } as const;

/** Search engines show about this much of a description. */
const DESCRIPTION_MAX = 158;

export function clip(text: string, max = DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** A page's full title as search results and link previews show it. */
export function fullTitle(title: string): string {
  return title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
}

/**
 * One public page's metadata: its title, description, canonical address and
 * link previews. `noindex` keeps it out of search results (its links are still followed).
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  image,
  noindex = false,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article" | "profile";
  /** An absolute image URL for the preview; the site's share image otherwise. */
  image?: string | null;
  noindex?: boolean;
  /** The title as given, without the site name after it (the homepage). */
  absoluteTitle?: boolean;
}): Metadata {
  const url = absoluteUrl(path);
  const shown = absoluteTitle ? title : fullTitle(title);
  const images = image ? [{ url: image }] : DEFAULT_OG_IMAGES;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    robots: noindex ? NOINDEX : { index: true, follow: true },
    openGraph: { ...SITE_OG, type, title: shown, description, url, images },
    twitter: { card: "summary_large_image", title: shown, description, images: images.map((i) => i.url) },
  };
}

/** The site's structured data, on the homepage: who runs it, and its agent search. */
export function siteJsonLd(): object[] {
  const url = absoluteUrl("/");
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${url}#organization`,
      name: BRAND_NAME,
      alternateName: SITE_NAME,
      url,
      logo: absoluteUrl("/icon1.png"),
      description: SITE_DESCRIPTION,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${url}#website`,
      name: SITE_NAME,
      alternateName: BRAND_NAME,
      url,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${url}#organization` },
      inLanguage: "en",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl(AGENTS_DIRECTORY_HREF)}?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ];
}
