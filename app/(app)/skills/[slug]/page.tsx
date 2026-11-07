import { notFound } from "next/navigation";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { getSkillBySlug, SkillUnavailableError, type SkillItem } from "../skills-data";
import { CopyPromptButton, CopyCommandButton } from "./copy-button";

/** GAP 3: a failing database renders this instead of a misleading 404. */
function SkillUnavailableBanner() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 py-16 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">Skill unavailable</h1>
      <p role="alert" className="text-sm text-zk-text2">
        The skills library is temporarily unavailable, so this skill can&apos;t be loaded right now. Please try
        again in a moment.
      </p>
      <Link
        href="/skills"
        className="inline-flex items-center justify-center rounded-xl border border-zk-border bg-zk-chip px-4 py-2 text-xs font-semibold text-zk-text hover:bg-zk-tint transition"
      >
        ← Back to Library
      </Link>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let skill: SkillItem | undefined;
  try {
    skill = await getSkillBySlug(slug);
  } catch (error) {
    if (!(error instanceof SkillUnavailableError)) throw error;
    return {
      title: "Skills Library Unavailable — Ziki",
      description: "The skills library is temporarily unavailable. Please try again shortly.",
    };
  }

  if (!skill) {
    return {
      title: "Skill Not Found — Ziki",
      description: "The requested skill does not exist in the library.",
    };
  }

  return {
    title: `${skill.title} — Skills Library — Ziki`,
    description: skill.description,
    openGraph: {
      title: `${skill.title} — Skills Library — Ziki`,
      description: skill.description,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${skill.title} — Skills Library — Ziki`,
      description: skill.description,
    },
  };
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let skill: SkillItem | undefined;
  try {
    skill = await getSkillBySlug(slug);
  } catch (error) {
    if (!(error instanceof SkillUnavailableError)) throw error;
    return <SkillUnavailableBanner />;
  }

  if (!skill) {
    notFound();
  }

  // Schema.org Structured Data for Search Engines (safe with JsonLd escaping)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: skill.title,
    description: skill.description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "All",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: {
      "@type": "Person",
      name: skill.author.name,
    },
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-16">
      {/* JSON-LD Structured Data for Search Engines */}
      <JsonLd data={jsonLd} />

      {/* Skill banner */}
      <div className="rounded-2xl border border-zk-border bg-zk-surface p-6 sm:p-8 overflow-hidden shadow-xs">
        <div className="sm:flex sm:items-start sm:justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                Approved Skill
              </span>
              <span className="rounded-md bg-zk-chip px-2.5 py-0.5 text-xs font-mono text-zk-muted">
                #{skill.category}
              </span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-zk-text sm:text-3xl sm:leading-tight">
              {skill.title}
            </h1>
            <p className="text-sm text-zk-text2 leading-relaxed sm:text-base max-w-2xl">
              {skill.description}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:shrink-0 mt-4 sm:mt-0">
            <CopyPromptButton prompt={skill.prompt} />
            <Link
              href="/skills"
              className="inline-flex items-center justify-center rounded-xl border border-zk-border bg-zk-chip px-4 py-2 text-xs font-semibold text-zk-text hover:bg-zk-tint transition"
            >
              ← Back to Library
            </Link>
          </div>
        </div>

        <div className="mt-5 sm:mt-6 flex flex-wrap items-center gap-3 text-xs text-zk-muted pt-3.5 border-t border-zk-divider">
          <span>
            Authored by <strong className="text-zk-text">{skill.author.name}</strong>
          </span>
          {skill.spec.documentationUrl && (
            <>
              <span>•</span>
              <a
                href={skill.spec.documentationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-zk-accent hover:underline inline-flex items-center gap-1"
              >
                <span>Documentation</span>
                <span>↗</span>
              </a>
            </>
          )}
        </div>
      </div>

      {/* Main Grid: Content & Meta */}
      <div className="grid grid-cols-1 gap-6 lg:gap-8 lg:grid-cols-3">
        {/* Left Column: Spec, Checklist, Prompt */}
        <div className="space-y-6 lg:col-span-2">
          {/* Overview */}
          <section className="space-y-2.5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zk-muted">Overview</h2>
            <p className="text-sm text-zk-text leading-relaxed">
              {skill.spec.overview}
            </p>
          </section>

          {/* Contributor's Checklist */}
          {skill.spec.checklist.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zk-muted">
                Contributor&apos;s Checklist
              </h2>
              <div className="rounded-2xl border border-zk-border bg-zk-surface p-5 space-y-2.5">
                {skill.spec.checklist.map((item, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs text-zk-text leading-relaxed">
                    <span className="text-zk-muted font-bold shrink-0">•</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Sample CLI Command */}
          {skill.spec.sampleCommand && (
            <section className="space-y-2.5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zk-muted">Sample Command</h2>
              <div className="flex items-center justify-between rounded-xl border border-zk-border bg-zk-chip px-4 py-3">
                <code className="text-xs font-mono text-zk-text truncate mr-2">
                  {skill.spec.sampleCommand}
                </code>
                <CopyCommandButton command={skill.spec.sampleCommand} />
              </div>
            </section>
          )}

          {/* Agent System Instructions Box */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zk-muted">Agent System Instructions</h2>
              <CopyPromptButton prompt={skill.prompt} label="Copy Instructions" />
            </div>
            <div className="relative rounded-2xl border border-zk-border bg-zk-chip p-5">
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs font-mono text-zk-text leading-relaxed select-text">
                {skill.prompt}
              </pre>
            </div>
          </section>
        </div>

        {/* Right Sidebar: Skill Information & Tags */}
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-2xl border border-zk-border bg-zk-surface p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zk-muted">Skill Details</h3>
            <div className="space-y-3 text-xs divide-y divide-zk-divider">
              <div className="pt-2 flex justify-between">
                <span className="text-zk-muted">Category</span>
                <span className="font-semibold text-zk-text">{skill.categoryLabel}</span>
              </div>
              <div className="pt-2 flex justify-between">
                <span className="text-zk-muted">Status</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  Approved
                </span>
              </div>
              <div className="pt-2 flex justify-between">
                <span className="text-zk-muted">Author</span>
                <span className="font-semibold text-zk-text">{skill.author.name}</span>
              </div>
            </div>
          </div>

          {skill.tags.length > 0 && (
            <div className="rounded-2xl border border-zk-border bg-zk-surface p-5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zk-muted">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-zk-chip px-2 py-1 text-[10px] font-mono text-zk-text2"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-zk-border bg-zk-surface p-5 text-center space-y-2">
            <p className="text-xs text-zk-muted">
              Looking for other approved skills?
            </p>
            <Link
              href="/skills"
              className="inline-block text-xs font-bold text-zk-accent hover:underline"
            >
              Browse All Skills in Library →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
