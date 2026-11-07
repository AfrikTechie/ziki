/**
 * Old business links from earners' emails (#earn-outreach): ziki.dev/r/<code>. Ziki Earn is part of Ziki now
 * (#earnings), so a link someone already emailed simply opens Ziki's home page. The redirect is a path, not an
 * absolute URL: behind the proxy the request's own address is the server's internal one.
 */
export function GET() {
  return new Response(null, { status: 307, headers: { Location: "/", "Cache-Control": "no-store" } });
}
