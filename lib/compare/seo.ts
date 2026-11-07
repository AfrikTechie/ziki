import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { SHARE_IMAGE } from "@/lib/share-image";
import { fullTitle, SITE_OG } from "@/lib/seo/site";
import type { BuiltComparison, PlatformData } from "./build";
import { COMPARE_HREF, comparisonHref } from "./slug";


export function directoryMetadata(): Metadata {
  const title = "Compare Ziki with other AI platforms";
  const description =
    "Compare Ziki with AI assistants, agent platforms, coding tools, frameworks and automation tools. Verified features, honest limitations and the date each fact was checked.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(COMPARE_HREF) },
    openGraph: { ...SITE_OG, type: "website", title: fullTitle(title), description, url: absoluteUrl(COMPARE_HREF), images: [{ ...SHARE_IMAGE }] },
    twitter: { card: "summary_large_image", title: fullTitle(title), description, images: [SHARE_IMAGE.url] },
  };
}

export function comparisonMetadata(built: BuiltComparison, a: PlatformData, b: PlatformData): Metadata {
  const href = comparisonHref(a.slug, b.slug);
  const url = absoluteUrl(href);
  const title = built.seoTitle;
  return {
    title,
    description: built.seoDescription,
    // Every pair has one canonical URL; the other order redirects to it.
    alternates: { canonical: url },
    robots: built.indexable ? undefined : { index: false, follow: true },
    openGraph: { ...SITE_OG, type: "article", title: fullTitle(title), description: built.seoDescription, url, images: [{ ...SHARE_IMAGE }] },
    twitter: { card: "summary_large_image", title: fullTitle(title), description: built.seoDescription, images: [SHARE_IMAGE.url] },
  };
}

function software(p: PlatformData) {
  return {
    "@type": "SoftwareApplication",
    name: p.name,
    url: p.websiteUrl,
    description: p.description,
    applicationCategory: "BusinessApplication",
  };
}

/** schema.org objects for a comparison page: the page, the two products it is about, and its breadcrumb. */
export function comparisonJsonLd(built: BuiltComparison, a: PlatformData, b: PlatformData) {
  const url = absoluteUrl(comparisonHref(a.slug, b.slug));
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: built.title,
      description: built.seoDescription,
      url,
      dateModified: built.updatedAt.toISOString(),
      about: [software(a), software(b)],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ziki", item: absoluteUrl("/") },
        { "@type": "ListItem", position: 2, name: "Compare", item: absoluteUrl(COMPARE_HREF) },
        { "@type": "ListItem", position: 3, name: built.title, item: url },
      ],
    },
  ];
}

export function directoryJsonLd(count: number) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Compare Ziki with other AI platforms",
    url: absoluteUrl(COMPARE_HREF),
    description: `${count} comparisons of Ziki with other AI platforms.`,
  };
}
