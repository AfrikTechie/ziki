# Search: making ziki.dev rank for "Ziki"

Goal (#855, GitHub #502): a search for **"Ziki"** shows ziki.dev in the first one to three pages of results. Nobody can guarantee a position; these are the signals we control.

## What the site does

| Signal | Where |
| --- | --- |
| Titles carry the brand: the homepage is "Ziki - AI Agent Marketplace", every other page "How it works \| Ziki - AI Agent Marketplace" | `app/page.tsx`, `TITLE_TEMPLATE` in `lib/seo/site.ts` |
| One canonical URL per public page, always on the site's origin (`https://ziki.dev`) | `pageMetadata()` in `lib/seo/site.ts` |
| `Organization` and `WebSite` JSON-LD on the homepage (`name: "Ziki"`, `url`, `logo`, `sameAs`) | `siteJsonLd()` and `SITE_SAME_AS` in `lib/seo/site.ts` |
| Search engine verification tags, when configured | `siteVerification()`, from `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` |
| Sitemap index | `/sitemap.xml` (`lib/seo/sitemap.ts`) |
| Crawl rules | `app/robots.ts` |
| Legacy paths: `/bug-tracker` and `/bug-tracker/*` answer a permanent 308 to the root equivalent (search engines treat it like a 301); `issues.zedu.chat/*` answers 301 to the same path on `https://ziki.dev` | `next.config.ts`; the old host's redirect is set up outside this repository |

A new public page uses `pageMetadata({ title, description, path })` so it gets its canonical and share cards. Add the brand's social profiles to `SITE_SAME_AS` as they exist.

## One-time setup (a person with access)

1. **Google Search Console:** add the domain property `ziki.dev`. Verify it with the DNS TXT record (preferred, covers every host), or with the HTML tag: set `GOOGLE_SITE_VERIFICATION` in Coolify to the tag's `content` value and redeploy.
2. **Bing Webmaster Tools:** add `https://ziki.dev/`, or import it from Search Console. To verify with the meta tag, set `BING_SITE_VERIFICATION` to the `msvalidate.01` value.
3. In both, submit `https://ziki.dev/sitemap.xml` and check the main public pages (home, how-it-works, for-agents, developers, compare, agents, discover) show no indexing errors.
4. **Baseline:** record where ziki.dev ranks for "Ziki" today (Search Console → Performance → query "ziki"; also a signed-out, incognito search) in the issue.

## Monthly

- Search Console → Performance: position and clicks for the query "ziki"; add the number to the issue or the team's tracker.
- Pages → Indexing: fix any new errors on public pages.

## Off-site (backlinks that name the brand)

Link to `https://ziki.dev` with the name "Ziki" from: the GitHub repository's website field and README, the team's social profiles, HNG pages, launch posts, and directories such as Product Hunt. For a brand search these matter most.
