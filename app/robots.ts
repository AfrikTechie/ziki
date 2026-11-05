import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

/**
 * Owns robots.txt rather than letting the platform generate it (#224).
 *
 * The previous file was only Vercel's auto-injected content-signals comment
 * block: no `User-agent` rules, no `Disallow`, and no `Content-Signal`
 * directives despite the preamble describing them at length.
 *
 * Issue pages (`/<org>/<project>/<number>`) are intentionally left crawlable.
 * Link previews are a supported feature (Slack / WhatsApp / Discord unfurls
 * of shared issue links), and those crawlers do fetch the URL. Everything that
 * must not be walked - admin, settings, the API and the auth pages - is
 * disallowed here. Read access to issue pages for link-preview clients is a
 * separate, deliberate concern tracked in the User-Agent spoofing report.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/superadmin",
          "/settings",
          "/api/",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    // Points crawlers at the sitemap (#310), on the configured origin.
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}