"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { type SkillItem } from "./skills-data";

interface SkillsDirectoryProps {
  skills: SkillItem[];
  loadError?: string;
}

/**
 * Public directory panel for the Skills Library.
 * Handles category filtering, real-time keyword search, and prompt copying.
 */
export function SkillsDirectory({ skills, loadError }: SkillsDirectoryProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Category counts matching available skills
  const categories = useMemo(() => {
    return [
      { id: "all", label: "All Skills", count: skills.length },
      {
        id: "testing",
        label: "Testing & QA",
        count: skills.filter((s) => s.category === "testing").length,
      },
      {
        id: "security",
        label: "Security",
        count: skills.filter((s) => s.category === "security").length,
      },
      {
        id: "design",
        label: "Design & UI",
        count: skills.filter((s) => s.category === "design").length,
      },
      {
        id: "backend",
        label: "Backend & Database",
        count: skills.filter((s) => s.category === "backend").length,
      },
      {
        id: "marketing",
        label: "SEO & Content",
        count: skills.filter((s) => s.category === "marketing").length,
      },
    ];
  }, [skills]);

  // Filter skills by category and search query
  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const matchesCategory =
        selectedCategory === "all" || skill.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        skill.title.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags.some((tag) => tag.toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [skills, selectedCategory, searchQuery]);

  async function copyPrompt(skill: SkillItem) {
    try {
      await navigator.clipboard.writeText(skill.prompt);
      showToast(`Copied "${skill.title}" prompt to clipboard!`);
    } catch {
      showToast("Unable to copy to clipboard.");
    }
  }

  function showToast(message: string) {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-8 pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-zk-border bg-zk-surface px-5 py-3.5 text-sm font-semibold text-zk-text shadow-2xl transition-all"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zk-ok-bg text-zk-ok-fg text-xs font-bold">
            ✓
          </span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.03em] text-zk-text">
              Agent Skills Library
            </h1>
            <p className="text-sm text-zk-text2 leading-relaxed max-w-[680px]">
              Discover agent prompts, scripts, and security guardrails published by the community and approved by a reviewer.
            </p>
          </div>
          <Link
            href="/earn/skills"
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:brightness-110 transition shrink-0"
          >
            <span>+ Submit a Skill</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-y border-zk-divider py-4">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                selectedCategory === cat.id
                  ? "bg-zk-text text-zk-surface"
                  : "bg-zk-chip text-zk-text2 hover:bg-zk-tint hover:text-zk-text"
              }`}
            >
              <span>{cat.label}</span>
              <span className="text-[10px] opacity-70">({cat.count})</span>
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64 shrink-0">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills or tags..."
            className="w-full rounded-full border border-zk-border bg-zk-surface px-4 py-1.5 text-xs text-zk-text placeholder:text-zk-muted focus:border-blue-600 focus:outline-hidden"
          />
        </div>
      </div>

      {/* Empty State */}
      {loadError ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-12 text-center space-y-3">
          <p className="text-base font-semibold text-rose-600 dark:text-rose-400">Failed to load skills library</p>
          <p className="text-xs text-zk-muted max-w-sm mx-auto">
            {loadError}
          </p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="rounded-2xl border border-zk-border bg-zk-surface/50 p-12 text-center space-y-3">
          <p className="text-base font-semibold text-zk-text">No skills found</p>
          <p className="text-xs text-zk-muted max-w-sm mx-auto">
            {searchQuery
              ? `No skills matched your search query "${searchQuery}".`
              : "No approved skills published in this category yet."}
          </p>
        </div>
      ) : (
        /* Skill Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredSkills.map((skill) => (
            <div
              key={skill.id}
              className="flex flex-col justify-between rounded-2xl border border-zk-border bg-zk-surface p-5 hover:border-zk-border-hover hover:shadow-md transition-all"
            >
              <div className="space-y-3">
                {/* Header: Icon, Category & Link */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zk-chip text-zk-text">
                      <SkillIcon icon={skill.icon} />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-zk-muted uppercase tracking-wider">
                        {skill.categoryLabel}
                      </span>
                      <h2 className="text-sm font-bold text-zk-text hover:text-zk-accent transition line-clamp-1">
                        <Link href={`/skills/${skill.slug}`}>{skill.title}</Link>
                      </h2>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-zk-text2 leading-relaxed line-clamp-2">
                  {skill.description}
                </p>

                {/* Tags */}
                {skill.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {skill.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-zk-chip px-2 py-0.5 text-[10px] font-medium text-zk-muted"
                      >
                        #{tag}
                      </span>
                    ))}
                    {skill.tags.length > 3 && (
                      <span className="text-[10px] text-zk-muted self-center">
                        +{skill.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Actions */}
              <div className="mt-5 space-y-2 border-t border-zk-divider pt-3.5">
                <button
                  type="button"
                  onClick={() => copyPrompt(skill)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-zk-chip hover:bg-zk-tint py-2 text-xs font-semibold text-zk-text transition"
                >
                  <svg className="h-3.5 w-3.5 text-zk-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Copy System Prompt</span>
                </button>
                <Link
                  href={`/skills/${skill.slug}`}
                  className="flex w-full items-center justify-center gap-1.5 text-center text-xs font-medium text-zk-muted hover:text-zk-text transition py-1"
                >
                  <span>View Details &amp; Spec</span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillIcon({ icon }: { icon: SkillItem["icon"] }) {
  switch (icon) {
    case "flutter":
      return (
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case "shield":
      return (
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    case "browser":
      return (
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      );
    case "figma":
      return (
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      );
    case "database":
      return (
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
      );
    case "a11y":
      return (
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      );
    case "test":
      return (
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case "api":
    default:
      return (
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
  }
}
