import { SITEMAP_HEADERS, sitemapSectionXml } from "@/lib/seo/sitemap";

export const dynamic = "force-dynamic";

/** /sitemaps/{section}.xml (#seo-sitemap): one section of the sitemap, built from the database. 404 for a name that isn't one. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const xml = await sitemapSectionXml(file);
  if (xml === null) return new Response("Not found", { status: 404 });
  return new Response(xml, { headers: SITEMAP_HEADERS });
}
