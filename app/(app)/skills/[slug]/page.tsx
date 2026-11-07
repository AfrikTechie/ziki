import { notFound } from "next/navigation";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { clip, NOINDEX, pageMetadata } from "@/lib/seo/site";
import { optionalUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getSkillBySlug, SkillUnavailableError, type SkillItem } from "../skills-data";
import { SkillIcon } from "../skills-directory";
import {
  SkillDetailInteractive,
  SkillPromptSection,
  CopyCommandButton,
} from "./copy-button";

/** GAP 3: a failing database renders this instead of a misleading 404. */
function SkillUnavailableBanner() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 py-16 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-zk-text">
        Skill unavailable
      </h1>
      <p role="alert" className="text-sm text-zk-text2">
        The skills library is temporarily unavailable, so this skill can&apos;t
        be loaded right now. Please try again in a moment.
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
      title: "Skills library unavailable",
      description: "The skills library is temporarily unavailable. Please try again shortly.",
      robots: NOINDEX,
    };
  }

  if (!skill) {
    return {
      title: "Skill not found",
      description: "The requested skill does not exist in the library.",
      robots: NOINDEX,
    };
  }

  return pageMetadata({
    title: `${skill.title}: AI agent skill`,
    description: clip(skill.description),
    path: `/skills/${encodeURIComponent(skill.slug)}`,
    type: "article",
  });
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

  // Data loading: load agents owned by the signed-in viewer (guests get [])
  const user = await optionalUser();
  const agents =
    user
      ? await prisma
          .agent.findMany({
            where: { ownerUserId: user.id },
            select: { id: true, name: true, username: true },
            orderBy: { name: "asc" },
          })
          .catch(() => [])
      : [];

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

      {/* Hero Header */}
      <div className="rounded-2xl border border-zk-border bg-zk-surface p-6 sm:p-8 overflow-hidden shadow-xs">
        <div className="space-y-4 sm:space-y-6">
          {/* Breadcrumb */}
          <div className="flex items-center justify-between gap-2 text-xs text-zk-muted">
            <Link
              href="/skills"
              className="inline-flex items-center gap-1 hover:underline"
              aria-label="Back to Skills Library"
            >
              ← Back to Skills Library
            </Link>
            <span className="text-zk-muted">Skills / {skill.categoryLabel}</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <SkillIcon icon={skill.icon} />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zk-muted">
                  {skill.categoryLabel}
                </span>
                <h1 className="text-2xl font-extrabold tracking-tight text-zk-text sm:text-3xl sm:leading-tight">
                  {skill.title}
                </h1>
              </div>
            </div>
            <p className="text-sm text-zk-text2 leading-relaxed sm:text-base max-w-2xl">
              {skill.description}
            </p>
          </div>

          <SkillDetailInteractive
            skill={skill}
            agents={agents}
            isGuest={!user}
          />

          {/* Footer meta */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zk-muted pt-3.5 border-t border-zk-divider">
            <span>
              Authored by{" "}
              <strong className="text-zk-text">{skill.author.name}</strong>
            </span>
            {skill.spec.documentationUrl && (
              <>
                <span aria-hidden="true">•</span>
                <a
                  href={skill.spec.documentationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-zk-accent hover:underline inline-flex items-center gap-1"
                >
                  <span>Documentation</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Content & Meta */}
      <div className="grid grid-cols-1 gap-6 lg:gap-8 lg:grid-cols-3">
        {/* Left Column: Spec, Checklist, Prompt */}
        <div className="space-y-6 lg:col-span-2">
          {/* Overview & Objectives */}
          <section className="space-y-2.5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zk-muted">
              Overview &amp; Objectives
            </h2>
            <p className="text-sm text-zk-text leading-relaxed">
              {skill.spec.overview}
            </p>
          </section>

          {/* Quality & Verification Checklist */}
          {skill.spec.checklist.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zk-muted">
                Quality &amp; Verification Checklist
              </h2>
              <div className="rounded-2xl border border-zk-border bg-zk-surface p-5 space-y-2.5">
                {skill.spec.checklist.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 text-xs text-zk-text leading-relaxed"
                  >
                    <span
                      className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Sample CLI Command */}
          {skill.spec.sampleCommand && (
            <section className="space-y-2.5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zk-muted">
                CLI Verification Command
              </h2>
              <div className="rounded-xl border border-zk-border bg-zk-chip p-4">
                <div className="flex items-center gap-2 text-xs font-mono text-zk-text">
                  <span aria-hidden="true">$</span>
                  <span>{skill.spec.sampleCommand}</span>
                </div>
                <CopyCommandButton command={skill.spec.sampleCommand} />
              </div>
            </section>
          )}

          {/* Agent System Instructions */}
          <SkillPromptSection skill={skill} agents={agents} />
        </div>

        {/* Right Sidebar: Skill Information & Tags */}
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-2xl border border-zk-border bg-zk-surface p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zk-muted">
              Specification
            </h3>
            <div className="space-y-3 text-xs divide-y divide-zk-divider">
              <div className="pt-2 flex justify-between">
                <span className="text-zk-muted">Category</span>
                <span className="font-semibold text-zk-text">
                  {skill.categoryLabel}
                </span>
              </div>
              <div className="pt-2 flex justify-between">
                <span className="text-zk-muted">Compatible Agents</span>
                <span className="font-semibold text-zk-text">
                  All AI Agents
                </span>
              </div>
              <div className="pt-2 flex justify-between">
                <span className="text-zk-muted">Author</span>
                <span className="font-semibold text-zk-text">
                  {skill.author.name}
                </span>
              </div>
              {skill.spec.sampleCommand && (
                <div className="pt-2 flex justify-between">
                  <span className="text-zk-muted">Verification</span>
                  <span className="font-semibold text-zk-text">CLI command</span>
                </div>
              )}
              {skill.spec.documentationUrl && (
                <div className="pt-2 flex justify-between">
                  <span className="text-zk-muted">Documentation</span>
                  <a
                    href={skill.spec.documentationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-zk-accent hover:underline inline-flex items-center gap-1"
                  >
                    <span>Reference</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              )}
            </div>
          </div>

          {skill.tags.length > 0 && (
            <div className="rounded-2xl border border-zk-border bg-zk-surface p-5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zk-muted">
                Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/skills?search=${encodeURIComponent(tag)}`}
                    className="rounded-md bg-zk-chip px-2 py-1 text-[10px] font-mono text-zk-text2 hover:bg-zk-border transition"
                  >
                    #{tag}
                  </Link>
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
