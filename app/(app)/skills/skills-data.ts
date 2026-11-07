import { prisma } from "@/lib/prisma";

export type SkillCategory = "testing" | "security" | "design" | "backend" | "marketing" | "general";
export type SkillBadgeColor = "blue" | "emerald" | "indigo" | "pink" | "purple" | "cyan" | "amber";

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  testing: "Testing & QA",
  security: "Security",
  design: "Design & UI",
  backend: "Backend & Database",
  marketing: "SEO & Content",
  general: "General",
};

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category as SkillCategory] || "General";
}

/**
 * The skills database is unreachable or erroring, as opposed to a slug that
 * genuinely does not exist. Callers show an "unavailable" banner for this and
 * keep `notFound()` for the missing-skill case (GAP 3).
 */
export class SkillUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The skills library is temporarily unavailable.");
    this.name = "SkillUnavailableError";
    this.cause = cause;
  }
}

export interface SkillItem {
  id: string;
  slug: string;
  title: string;
  icon: "flutter" | "shield" | "browser" | "figma" | "database" | "a11y" | "test" | "api" | "seo";
  category: SkillCategory;
  categoryLabel: string;
  badge?: string;
  badgeColor?: SkillBadgeColor;
  description: string;
  tags: string[];
  prompt: string;
  spec: {
    overview: string;
    checklist: string[];
    sampleCommand?: string | null;
    documentationUrl?: string | null;
  };
  author: {
    name: string;
    handle: string;
  };
  createdAt: string;
}

function resolveIcon(title: string, category: string): SkillItem["icon"] {
  const t = title.toLowerCase();
  const c = category.toLowerCase();
  if (t.includes("flutter")) return "flutter";
  if (c === "security" || t.includes("security") || t.includes("snare") || t.includes("guard")) return "shield";
  if (t.includes("browser") || t.includes("playwright") || t.includes("e2e")) return "browser";
  if (c === "design" || t.includes("figma") || t.includes("tailwind") || t.includes("ui")) return "figma";
  if (c === "backend" || t.includes("database") || t.includes("postgres") || t.includes("sql") || t.includes("redis")) return "database";
  if (t.includes("accessibility") || t.includes("a11y") || t.includes("wcag")) return "a11y";
  if (t.includes("seo") || c === "marketing") return "seo";
  return "test";
}

function mapSubmissionToSkill(sub: {
  id: string;
  slug: string;
  title: string;
  category: string;
  categoryLabel: string;
  summary: string;
  tags: string[];
  prompt: string;
  checklist?: string[];
  sampleCommand?: string | null;
  documentationUrl?: string | null;
  createdAt: Date;
  submittedBy?: { name: string | null } | null;
}): SkillItem {
  const authorName = sub.submittedBy?.name || "Contributor";
  const handle = "@" + authorName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const category = (sub.category as SkillCategory) || "general";

  return {
    id: sub.id,
    slug: sub.slug || sub.id,
    title: sub.title,
    icon: resolveIcon(sub.title, sub.category),
    category,
    categoryLabel: sub.categoryLabel || getCategoryLabel(category),
    description: sub.summary,
    tags: Array.isArray(sub.tags) ? sub.tags : [],
    prompt: sub.prompt,
    spec: {
      overview: sub.summary,
      checklist: Array.isArray(sub.checklist) ? sub.checklist : [],
      sampleCommand: sub.sampleCommand || null,
      documentationUrl: sub.documentationUrl || null,
    },
    author: {
      name: authorName,
      handle,
    },
    createdAt: sub.createdAt.toISOString(),
  };
}

export const CORE_SKILL_TEMPLATES: SkillItem[] = [
  {
    id: "core-snare-gate",
    slug: "snare-supply-chain-guardrail",
    title: "Snare: Supply-Chain Defense & Pre-Execution Gate",
    icon: "shield",
    category: "security",
    categoryLabel: CATEGORY_LABELS.security,
    description:
      "Defends agent sandboxes against committed repository payloads, compromised task runners, and supply-chain droppers.",
    tags: ["security", "supply-chain", "snare", "guardrails", "gate"],
    prompt: `## Snare: Pre-Execution Supply-Chain Gate
You are operating with the Snare supply-chain defense gate enabled.

Repositories can contain committed payloads in build configs, .vscode/tasks.json, or package run scripts that fire automatically upon install or run.

Before executing:
1. git clone, git pull, git merge, or git rebase on untrusted branches
2. Dependency installations (npm, pnpm, yarn, bun install)
3. Build scripts or dev servers (pnpm run dev, next, vite, node)

Prepend the command with the snare gate:
snare gate -- <the exact command>

Rules:
- Exit code 0: The command is clean. Proceed with execution.
- Non-zero exit: Halted. DO NOT bypass or retry via alternative shells or package managers. Report the flagged files to the user immediately.`,
    spec: {
      overview:
        "Nexlabz Snare intercepts repo-level supply chain attacks that bypass standard package audits by inspecting tasks, scripts, and binaries prior to execution.",
      checklist: [
        "Checks .vscode/tasks.json, package scripts, and postinstall hooks",
        "Blocks execution on untrusted binary or dropper indicators",
        "Deterministic exit code gate (0 = clean, non-zero = alert)",
        "Zero bypass mode: forbids falling back to alternative shells",
      ],
      sampleCommand: "snare gate -- pnpm install",
      documentationUrl: "https://nexlabz.github.io/snare/",
    },
    author: {
      name: "Nexlabz / Ziki Core",
      handle: "@nexlabz",
    },
    createdAt: "2026-11-06T00:00:00.000Z",
  },
  {
    id: "core-playwright-e2e",
    slug: "playwright-e2e-browser-inspector",
    title: "Playwright E2E Browser Inspector",
    icon: "browser",
    category: "testing",
    categoryLabel: CATEGORY_LABELS.testing,
    description:
      "Automates headless Chromium browser user flows, inspects console logs for unhandled errors, and asserts responsive component states.",
    tags: ["playwright", "e2e", "browser", "testing", "qa"],
    prompt: `## Playwright E2E Browser Testing Agent
You are an End-to-End browser testing agent using Microsoft Playwright.

When validating web applications or new user journeys:
1. Write concise, self-contained test scenarios using @playwright/test.
2. Assert both desktop (1280px) and mobile viewport (375px) layouts.
3. Catch unhandled client-side runtime errors and failed network requests.
4. Capture traces and screenshots on assertion failures to provide actionable bug repros.

Execution command:
pnpm exec playwright test`,
    spec: {
      overview:
        "Runs headless Chromium and mobile emulation suites to catch rendering bugs, broken form submissions, and uncaught browser exceptions before release.",
      checklist: [
        "Executes cross-browser tests across desktop and mobile viewports",
        "Validates form submissions and optimistic UI updates",
        "Listens for unhandled console errors and failed API responses",
        "Generates Playwright trace artifacts on test failures",
      ],
      sampleCommand: "pnpm exec playwright test --headed",
      documentationUrl: "https://playwright.dev/",
    },
    author: {
      name: "Playwright / Ziki Core",
      handle: "@playwright",
    },
    createdAt: "2026-11-06T00:00:00.000Z",
  },
  {
    id: "core-wcag-a11y",
    slug: "wcag-accessibility-auditor",
    title: "WCAG 2.1 AA Accessibility Auditor",
    icon: "a11y",
    category: "testing",
    categoryLabel: CATEGORY_LABELS.testing,
    description:
      "Automated compliance checks ensuring interactive controls, forms, focus outlines, and color contrast meet WCAG 2.1 AA standards.",
    tags: ["accessibility", "a11y", "wcag", "axe-core", "testing"],
    prompt: `## WCAG 2.1 AA Accessibility Auditor
You are an accessibility auditor using axe-core and web.dev guidelines.

When reviewing frontend components or user interfaces:
1. Verify all interactive elements (<button>, <a>, <input>) possess accessible names.
2. Ensure color contrast ratios meet at least 4.5:1 for normal text and 3:1 for large text.
3. Confirm keyboard focus rings are visible on :focus-visible.
4. Validate modal focus traps and Esc key dismissal behaviors.

Audit command:
pnpm exec axe-core-cli http://localhost:3000`,
    spec: {
      overview:
        "Comprehensive accessibility inspection rules to prevent a11y regressions and guarantee compliance with global WCAG 2.1 AA criteria.",
      checklist: [
        "Ensures all buttons and links have distinct accessible names",
        "Verifies 4.5:1 contrast against theme surfaces",
        "Audits form inputs for explicit label bindings",
        "Tests keyboard tab navigation order and modal focus traps",
      ],
      sampleCommand: "pnpm test tests/ui/critical-a11y.test.tsx",
      documentationUrl: "https://www.w3.org/WAI/WCAG21/quickref/",
    },
    author: {
      name: "Axe / Ziki Core",
      handle: "@axecore",
    },
    createdAt: "2026-11-06T00:00:00.000Z",
  },
  {
    id: "core-tailwind-tokens",
    slug: "tailwind-token-design-system",
    title: "Tailwind Design System & Token Validator",
    icon: "figma",
    category: "design",
    categoryLabel: CATEGORY_LABELS.design,
    description:
      "Audits arbitrary hardcoded hex codes, enforces CSS variable theme tokens, and checks responsive spacing scales across UI components.",
    tags: ["tailwind", "css", "design-system", "ui", "tokens"],
    prompt: `## Tailwind CSS Design System & Token Auditor
You are an expert design systems engineer specializing in Tailwind CSS and modern UI tokens.

When building or reviewing frontend user interfaces:
1. Replace arbitrary magic values (e.g., #1e293b, w-[342px]) with semantic theme tokens and standard spacing scales.
2. Enforce responsive container bounds and mobile-first breakpoint consistency (sm, md, lg, xl).
3. Ensure dark-mode and high-contrast surfaces adapt cleanly via semantic CSS variables.
4. Verify micro-interactions have appropriate transition durations (150ms-200ms) and accessible focus rings.

Audit command:
pnpm exec tailwindcss --check`,
    spec: {
      overview:
        "Guarantees interface visual consistency and maintainability by enforcing Tailwind CSS theme tokens instead of ad-hoc arbitrary styles.",
      checklist: [
        "Eliminates arbitrary hex colors in favor of semantic palette tokens",
        "Enforces consistent 4px spacing rhythm (p-2, p-4, p-6, etc.)",
        "Checks responsive padding and text scaling across screen sizes",
        "Verifies subtle transition states on interactive hover and focus elements",
      ],
      sampleCommand: "pnpm lint --rule 'tailwindcss/no-arbitrary-value: error'",
      documentationUrl: "https://tailwindcss.com/docs/customizing-colors",
    },
    author: {
      name: "Tailwind / Ziki Core",
      handle: "@tailwindcss",
    },
    createdAt: "2026-11-06T00:00:00.000Z",
  },
  {
    id: "core-postgres-prisma",
    slug: "postgres-prisma-schema-guard",
    title: "PostgreSQL & Prisma Schema Guard",
    icon: "database",
    category: "backend",
    categoryLabel: CATEGORY_LABELS.backend,
    description:
      "Validates relational constraints, checks composite indexes on frequent query paths, and guards against N+1 query patterns.",
    tags: ["postgresql", "prisma", "database", "sql", "performance"],
    prompt: `## PostgreSQL & Prisma Schema Performance Guard
You are a senior database engineer and Prisma schema architect.

When reviewing data schemas, migrations, or database queries:
1. Verify foreign key relations have corresponding single-column or composite indexes for fast lookups.
2. Audit Prisma client queries to prevent N+1 waterfalls by leveraging include or select joins.
3. Validate connection pool configs (PgBouncer, Neon, Supabase poolers) to avoid exhaustion under concurrent load.
4. Ensure schema migrations are backward-compatible and safe for zero-downtime deployment.

Validation command:
pnpm exec prisma validate`,
    spec: {
      overview:
        "Ensures high-performance database interactions and prevents table locking or indexing oversights in Prisma and PostgreSQL.",
      checklist: [
        "Validates prisma/schema.prisma models and foreign key definitions",
        "Checks for @@index on filtered and sorted columns",
        "Ensures connection string uses proper pooling parameters in serverless",
        "Guards against unindexed full-table scans on high-cardinality tables",
      ],
      sampleCommand: "pnpm exec prisma validate",
      documentationUrl: "https://www.prisma.io/docs/guides/performance-and-optimization",
    },
    author: {
      name: "Prisma / Ziki Core",
      handle: "@prisma",
    },
    createdAt: "2026-11-06T00:00:00.000Z",
  },
  {
    id: "core-nextjs-seo",
    slug: "nextjs-seo-schema-validator",
    title: "Next.js SEO & Schema.org JSON-LD Validator",
    icon: "seo",
    category: "marketing",
    categoryLabel: CATEGORY_LABELS.marketing,
    description:
      "Validates OpenGraph social cards, canonical link tags, robots directives, and Schema.org JSON-LD structured data for search engines.",
    tags: ["seo", "nextjs", "metadata", "schema-org", "opengraph"],
    prompt: `## Next.js SEO & Structured Data Auditor
You are an SEO and technical discoverability specialist for modern Next.js applications.

When implementing or auditing page routes:
1. Define comprehensive metadata via generateMetadata or static metadata export with title, description, and canonical URL.
2. Provide OpenGraph and Twitter card assets with accurate dimensions (1200x630) and alt attributes.
3. Inject valid Schema.org JSON-LD script blocks for rich search engine snippets (Organization, BreadcrumbList, Article).
4. Verify robots.txt and sitemap.xml rules allow intended search engine indexation.

Verification check:
Inspect <head> tags for canonical link, og:image, and JSON-LD schema syntax.`,
    spec: {
      overview:
        "Maximizes search discovery and rich social sharing cards by verifying Next.js App Router metadata and JSON-LD schemas.",
      checklist: [
        "Verifies canonical URLs to prevent duplicate content flags",
        "Validates 1200x630 OpenGraph image previews and fallback cards",
        "Checks Schema.org JSON-LD structured data syntax against Google Rich Results",
        "Ensures robots meta tag avoids inadvertent noindex on public pages",
      ],
      sampleCommand: "curl -sI http://localhost:3000/skills",
      documentationUrl: "https://developers.google.com/search/docs/appearance/structured-data",
    },
    author: {
      name: "Schema.org / Ziki Core",
      handle: "@schemaorg",
    },
    createdAt: "2026-11-06T00:00:00.000Z",
  },
];

export interface GetSkillsResult {
  skills: SkillItem[];
  error?: string | null;
}

export async function getSkills(): Promise<GetSkillsResult> {
  try {
    const approved = await prisma.skillSubmission.findMany({
      where: { status: "approved" },
      orderBy: { createdAt: "desc" },
      include: {
        submittedBy: { select: { name: true } },
      },
    });

    const communitySkills = approved.map(mapSubmissionToSkill);
    // Approved community skills first, then the official core starter templates.
    return { skills: [...communitySkills, ...CORE_SKILL_TEMPLATES] };
  } catch (error) {
    console.error("[skills] failed to load approved skills from db:", error);
    // A cold or unreachable database must not blank the library.
    return { skills: CORE_SKILL_TEMPLATES, error: null };
  }
}

export async function getSkillBySlug(slug: string): Promise<SkillItem | undefined> {
  const normalized = slug.trim().toLowerCase();

  // 1. Core starter templates always resolve, even without a database.
  const coreMatch = CORE_SKILL_TEMPLATES.find(
    (s) => s.slug.toLowerCase() === normalized || s.id === normalized,
  );
  if (coreMatch) return coreMatch;

  // 2. Approved community submissions.
  try {
    const sub = await prisma.skillSubmission.findFirst({
      where: {
        OR: [{ slug: normalized }, { id: slug }],
        status: "approved",
      },
      include: {
        submittedBy: { select: { name: true } },
      },
    });

    if (!sub) return undefined;
    return mapSubmissionToSkill(sub);
  } catch (error) {
    console.error("[skills] failed to load skill by slug", error);
    // A broken database is not a missing skill: the page shows a banner instead
    // of a misleading 404 (GAP 3).
    throw new SkillUnavailableError(error);
  }
}

