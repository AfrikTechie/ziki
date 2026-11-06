/**
 * The vocabulary of the comparison directory (#compare): platform categories,
 * how sure we are of a fact, and the dimensions two platforms are compared on.
 *
 * Platforms and comparisons are data (see prisma `ComparePlatform` and
 * `Comparison`), so a competitor is added in /superadmin/compare without
 * touching a component. Only this vocabulary lives in code.
 */

export const COMPARE_CATEGORIES = [
  { value: "general_assistant", label: "General AI assistants", short: "General AI assistant" },
  { value: "agent_platform", label: "AI agents", short: "AI agent platform" },
  { value: "coding_assistant", label: "AI coding assistants", short: "AI coding assistant" },
  { value: "dev_framework", label: "AI development tools", short: "AI development tool" },
  { value: "automation", label: "AI automation", short: "AI automation platform" },
  { value: "enterprise", label: "Enterprise AI platforms", short: "Enterprise AI platform" },
] as const;

export type CompareCategory = (typeof COMPARE_CATEGORIES)[number]["value"];

export const COMPARE_CATEGORY_VALUES = COMPARE_CATEGORIES.map((c) => c.value) as [CompareCategory, ...CompareCategory[]];

export function isCompareCategory(value: string): value is CompareCategory {
  return (COMPARE_CATEGORY_VALUES as string[]).includes(value);
}

export function categoryLabel(value: string): string {
  return COMPARE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function categoryShortLabel(value: string): string {
  return COMPARE_CATEGORIES.find((c) => c.value === value)?.short ?? value;
}

/** How sure we are. Anything nobody has checked against an official source is `not_verified`. */
export const FEATURE_STATUSES = [
  { value: "available", label: "Available" },
  { value: "partial", label: "Partially available" },
  { value: "not_available", label: "Not available" },
  { value: "not_verified", label: "Not verified" },
] as const;

export type FeatureStatus = (typeof FEATURE_STATUSES)[number]["value"];

export function isFeatureStatus(value: string): value is FeatureStatus {
  return FEATURE_STATUSES.some((s) => s.value === value);
}

export function statusLabel(status: FeatureStatus): string {
  return FEATURE_STATUSES.find((s) => s.value === status)?.label ?? "Not verified";
}

export type FeatureEntry = {
  status: FeatureStatus;
  /** What the status means for this platform, in one or two sentences. */
  note?: string;
  /** Where it was checked: an official page or document. */
  sourceUrl?: string;
};

export type FeatureMap = Record<string, FeatureEntry>;

const ALL = "all" as const;

export type CompareDimension = {
  key: string;
  label: string;
  /** What the row asks, shown under the label. */
  question: string;
  /** Categories this is a fair question for. A row shows only when it applies to both platforms' categories. */
  appliesTo: typeof ALL | readonly CompareCategory[];
};

/**
 * Not every platform here is a rival of every other (a chat assistant and a
 * workflow builder solve different problems), so a dimension carries the
 * categories it is a fair question for. Two platforms are compared only on
 * the dimensions that apply to both.
 */
export const COMPARE_DIMENSIONS: readonly CompareDimension[] = [
  {
    key: "agent_management",
    label: "AI agent management",
    question: "Can you register, configure and supervise several agents?",
    appliesTo: ["agent_platform", "enterprise", "dev_framework", "automation"],
  },
  {
    key: "task_execution",
    label: "Task execution",
    question: "Does it carry out tasks, or only advise?",
    appliesTo: ALL,
  },
  {
    key: "developer_workflows",
    label: "Developer workflows",
    question: "Does it fit into how software gets planned, built and shipped?",
    appliesTo: ["agent_platform", "coding_assistant", "dev_framework", "enterprise"],
  },
  {
    key: "issue_management",
    label: "Issue management",
    question: "Does it track work items from report to done?",
    appliesTo: ["agent_platform", "coding_assistant", "enterprise"],
  },
  {
    key: "pr_workflows",
    label: "Pull request workflows",
    question: "Does it handle pull requests: delivery, review, merge?",
    appliesTo: ["agent_platform", "coding_assistant"],
  },
  {
    key: "human_oversight",
    label: "Human oversight and approvals",
    question: "Can people review, approve or stop what the AI does?",
    appliesTo: ALL,
  },
  {
    key: "integrations",
    label: "Integrations",
    question: "How does it connect to other tools?",
    appliesTo: ALL,
  },
  {
    key: "collaboration",
    label: "Collaboration",
    question: "Can teams work in it together?",
    appliesTo: ALL,
  },
  {
    key: "pricing",
    label: "Pricing",
    question: "What does it cost, according to the vendor?",
    appliesTo: ALL,
  },
  {
    key: "ease_of_use",
    label: "Ease of use",
    question: "How quickly can a newcomer get a result?",
    appliesTo: ALL,
  },
];

export function dimensionApplies(dimension: CompareDimension, category: string): boolean {
  return dimension.appliesTo === ALL || (dimension.appliesTo as readonly string[]).includes(category);
}

/** The dimensions that are a fair question for both categories. */
export function sharedDimensions(categoryA: string, categoryB: string): CompareDimension[] {
  return COMPARE_DIMENSIONS.filter((d) => dimensionApplies(d, categoryA) && dimensionApplies(d, categoryB));
}

/** A platform's entry for a dimension; anything missing or malformed is `not_verified`. */
export function featureOf(features: unknown, key: string): FeatureEntry {
  if (features && typeof features === "object") {
    const raw = (features as Record<string, unknown>)[key];
    if (raw && typeof raw === "object") {
      const { status, note, sourceUrl } = raw as Record<string, unknown>;
      if (typeof status === "string" && isFeatureStatus(status)) {
        return {
          status,
          note: typeof note === "string" && note.trim() ? note.trim() : undefined,
          sourceUrl: typeof sourceUrl === "string" && /^https?:\/\//.test(sourceUrl) ? sourceUrl : undefined,
        };
      }
    }
  }
  return { status: "not_verified" };
}
