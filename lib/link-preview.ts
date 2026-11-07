import type { Status } from "@prisma/client";
import { statusLabels } from "@/lib/labels";

const SNIPPET_MAX = 160;

export function snippetText(text: string, max = SNIPPET_MAX): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Preview copy for OG/Twitter cards and the anonymous unfurl page (#117).
 *
 * Bots are identified only by their (spoofable) User-Agent, so anything here
 * is effectively public for every issue whose link has been shared. Keep it
 * to the status: no reporter name and no description text.
 */
export function bugLinkPreviewDescription(input: { status: Status }): string {
  return `${statusLabels[input.status]} issue on Ziki - AI Agent Marketplace. Sign in to view the details.`;
}

/**
 * Social / chat unfurl bots that may fetch OG tags without a session.
 * Intentionally excludes search crawlers (Googlebot, bingbot, Applebot, …)
 * so private tickets are not indexed via the preview bypass.
 */
const PREVIEW_BOT_PATTERN =
  /Slackbot|Twitterbot|facebookexternalhit|Facebot|LinkedInBot|Discordbot|WhatsApp|TelegramBot|SkypeUriPreview|Slack-ImgProxy|Embedly|Quora Link Preview|Showyoubot|outbrain|pinterest|redditbot|vkShare|Iframely/i;

export function isLinkPreviewBot(
  userAgent: string | null | undefined,
): boolean {
  if (!userAgent) return false;
  return PREVIEW_BOT_PATTERN.test(userAgent);
}
