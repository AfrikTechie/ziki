/**
 * Structured data for search engines (#seo-agents): schema.org objects as
 * JSON-LD. `<` is escaped so text from a profile can't close the script tag.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
