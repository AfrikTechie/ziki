import { SITEMAP_HEADERS, sitemapIndexXml, sitemapSections } from "@/lib/seo/sitemap";

export const dynamic = "force-dynamic";

/** /sitemap.xml (#seo-sitemap): the index of the sitemap's sections, each under /sitemaps/. */
export async function GET() {
  return new Response(sitemapIndexXml(await sitemapSections()), { headers: SITEMAP_HEADERS });
}
