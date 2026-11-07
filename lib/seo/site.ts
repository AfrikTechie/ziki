import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { SHARE_IMAGE } from "@/lib/share-image";

/**
 * Search signals for Ziki's own public pages (#855): one canonical URL per page, the brand's structured data,
 * and the search engines' site verification. Agent and comparison pages keep their own helpers
 * (lib/seo/agents.ts, lib/compare/seo.ts).
 */

export const SITE_NAME = "Ziki";
export const SITE_TAGLINE = "where people and AI agents build software together";
/** Where else "Ziki" is ziki.dev: the public repository. Add the brand's social profiles here as they exist. */
export const SITE_SAME_AS = ["https://github.com/emerjent/ziki"];

type PublicPage = {
  /** The page's path on the site, e.g. "/how-it-works". */
  path: string;
  /** The page's own title; the root layout's template adds "· Ziki". */
  title: string | { absolute: string };
  description: string;
};

/**
 * Metadata for a public page: its canonical URL on the site's one origin (so /bug-tracker paths and the old
 * host point search engines here), and full Open Graph and Twitter cards. A page that sets openGraph replaces
 * the root layout's, so the site name and share image are repeated here.
 */
export function publicPageMetadata({ path, title, description }: PublicPage): Metadata {
  const url = absoluteUrl(path);
  const shareTitle = typeof title === "string" ? `${title} · ${SITE_NAME}` : title.absolute;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { siteName: SITE_NAME, type: "website", url, title: shareTitle, description, images: [{ ...SHARE_IMAGE }] },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [SHARE_IMAGE.url] },
  };
}

/** The home page's structured data: Ziki the organisation, and ziki.dev the website, so search ties the name to the site. */
export function homeJsonLd(): object[] {
  const url = absoluteUrl("/");
  const organization = `${url}/#organization`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": organization,
      name: SITE_NAME,
      url,
      logo: absoluteUrl("/apple-icon.png"),
      description: `${SITE_NAME} is ${SITE_TAGLINE}.`,
      sameAs: SITE_SAME_AS,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${url}/#website`,
      name: SITE_NAME,
      url,
      publisher: { "@id": organization },
    },
  ];
}

/**
 * Google Search Console and Bing Webmaster Tools verification tags, from GOOGLE_SITE_VERIFICATION and
 * BING_SITE_VERIFICATION. Unset, no tag is emitted (verifying by DNS record needs neither).
 */
export function siteVerification(env: NodeJS.ProcessEnv = process.env): Metadata["verification"] {
  const google = env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = env.BING_SITE_VERIFICATION?.trim();
  if (!google && !bing) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { "msvalidate.01": bing } } : {}),
  };
}
