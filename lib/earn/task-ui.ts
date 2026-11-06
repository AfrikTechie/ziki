import type { EarnTaskId } from "@/lib/earn/draft";

/**
 * How each Marketing task looks and what to hand the agent (#423): an icon and
 * colour for its card, and a ready-to-paste instruction for the person's own
 * agent. The rules (pay, order, proof) live in lib/earn/draft.ts.
 */
/** About how long each task takes the earner, with their agent doing most of it. */
export const EARN_TASK_MINUTES: Record<EarnTaskId, number> = { who: 2, research: 10, emails: 15, post: 5 };

/** What a good answer has, shown as a short checklist above Send. */
export const EARN_TASK_CHECKS: Record<EarnTaskId, string[]> = {
  who: ["One kind of business, not a list", "Says where they are", "Says the problem Ziki solves for them"],
  research: ["Ten businesses", "A name and a way to reach each one", "They match the kind of business you picked"],
  emails: ["Sent from your own email", "Ziki copied on each one", "Your link is in every email"],
  post: ["Posted on X, LinkedIn or your WhatsApp status", "Your link is in the post", "Anyone can see it"],
};

export const EARN_TASK_UI: Record<EarnTaskId, { tint: string; icon: string; prompt: string }> = {
  who: {
    tint: "bg-zk-warn-bg text-zk-warn-fg",
    icon: "M12 3a5 5 0 0 1 5 5c0 3-2 4-2 6H9c0-2-2-3-2-6a5 5 0 0 1 5-5ZM9 18h6M10 21h4",
    prompt: "Suggest 5 kinds of small business that could use Ziki (ziki.dev), where AI agents build and market a product for you. For each one, say in a single line why it fits.",
  },
  research: {
    tint: "bg-zk-info-bg text-zk-info-fg",
    icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4",
    prompt: "Find 10 real small businesses that match the kind of business I described. For each one give me its name, where it is, and an email address or website I can reach it on.",
  },
  emails: {
    tint: "bg-zk-ok-bg text-zk-ok-fg",
    icon: "M4 6h16v12H4zM4 7l8 6 8-6",
    prompt: "Write a short, friendly email to each of those 10 businesses about Ziki (ziki.dev). Keep each one under 100 words, put my link in it, and give them to me ready to read and send.",
  },
  post: {
    tint: "bg-[#7C3AED]/10 text-[#6D28D9]",
    icon: "M4 12v7h16v-7M12 3v12M8 7l4-4 4 4",
    prompt: "Write three short, friendly posts about Ziki (ziki.dev), where AI agents build and market a product for you. Write them in my voice for X or LinkedIn, and put my link in each one.",
  },
};
