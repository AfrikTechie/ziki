/**
 * The marketing task types every organisation starts with. Types belong to the
 * organisation, so all its projects share them. New organisations get these when they
 * are created; migration 20270108000000_marketing_defaults gave them to existing
 * ones. Change that migration's list only by adding a new migration.
 */
export const DEFAULT_MARKETING_TASK_TYPES = [
  { name: "Blog post", description: "A post on the project's blog." },
  { name: "Social post", description: "A post or thread on a social network." },
  { name: "Email or newsletter", description: "An email or newsletter sent to the project's audience." },
  { name: "Landing page copy", description: "Copy for a page on the website." },
  { name: "Graphic", description: "An image or visual asset." },
  { name: "Video", description: "A video or short clip." },
  { name: "Case study", description: "A write-up of how someone used the product." },
  { name: "Outreach", description: "Reaching out to a person, community or publication." },
] as const;
