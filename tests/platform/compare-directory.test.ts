import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildComparison, type PlatformData } from "@/lib/compare/build";
import { sharedDimensions } from "@/lib/compare/catalog";
import { parsePlatformForm } from "@/lib/compare/admin-form";
import { COMPARE_BASELINE } from "@/lib/compare/baseline";
import { canonicalPair, isValidPlatformSlug, parseComparisonSlug } from "@/lib/compare/slug";

/**
 * The comparison directory (#compare): who may edit it, how pages are
 * addressed, which capabilities two platforms are compared on, and the
 * accuracy rules that keep it from becoming a marketing page.
 */

const requireSuperAdmin = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireSuperAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { comparePlatform: { create } } }));

const platform = (over: Partial<PlatformData>): PlatformData => ({
  id: over.slug ?? "p",
  slug: "x",
  name: "X",
  logoUrl: null,
  websiteUrl: "https://example.com",
  category: "general_assistant",
  description: "A thing.",
  useCases: [],
  strengths: [],
  limitations: [],
  pricingSummary: null,
  features: {},
  sourceUrls: [],
  isZiki: false,
  popular: false,
  lastVerifiedAt: null,
  updatedAt: new Date("2026-11-01"),
  ...over,
});

function platformForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    slug: "acme", name: "Acme", category: "automation", websiteUrl: "https://acme.example",
    description: "Acme automates things for teams.", sortOrder: "1",
  };
  for (const [k, v] of Object.entries({ ...base, ...fields })) fd.set(k, v);
  return fd;
}

describe("comparison URLs", () => {
  it("reads {a}-vs-{b} and refuses anything else", () => {
    expect(parseComparisonSlug("ziki-vs-chatgpt")).toEqual({ a: "ziki", b: "chatgpt" });
    expect(parseComparisonSlug("ziki-vs-ziki")).toBeNull();
    expect(parseComparisonSlug("ziki")).toBeNull();
    expect(parseComparisonSlug("a-vs-b-vs-c")).toBeNull();
    expect(parseComparisonSlug("%E0%A4%A")).toBeNull();
  });

  it("gives each pair one canonical order: Ziki first, otherwise alphabetical", () => {
    expect(canonicalPair("chatgpt", "ziki")).toEqual({ a: "ziki", b: "chatgpt" });
    expect(canonicalPair("n8n", "make")).toEqual({ a: "make", b: "n8n" });
  });

  it("never lets a platform slug contain the separator", () => {
    expect(isValidPlatformSlug("devin")).toBe(true);
    expect(isValidPlatformSlug("pros-vs-cons")).toBe(false);
  });
});

describe("what two platforms are compared on", () => {
  it("compares only capabilities that apply to both, so unlike products aren't scored on each other's turf", () => {
    const keys = sharedDimensions("agent_platform", "general_assistant").map((d) => d.key);
    expect(keys).toContain("human_oversight");
    expect(keys).not.toContain("pr_workflows");
    expect(keys).not.toContain("agent_management");
    expect(sharedDimensions("agent_platform", "coding_assistant").map((d) => d.key)).toContain("pr_workflows");
  });

  it("reads anything nobody checked as not verified, and never claims a competitor lacks a feature", () => {
    const ziki = platform({ slug: "ziki", name: "Ziki", category: "agent_platform", isZiki: true });
    const other = platform({ slug: "devin", name: "Devin", category: "agent_platform" });
    const built = buildComparison(other, ziki, null);
    expect(built.slug).toBe("ziki-vs-devin");
    expect(built.rows.length).toBeGreaterThan(0);
    for (const row of built.rows) expect(row.b.status).toBe("not_verified");
    expect(built.verifiedB).toBe(0);
    expect(built.relationship).toBe("direct");
  });

  it("indexes Ziki pairs and written pairs, not arbitrary pairs of competitors, and ignores an unpublished written pair", () => {
    const a = platform({ slug: "cursor", category: "coding_assistant" });
    const b = platform({ slug: "zapier", category: "automation" });
    const written = { title: "T", summary: "S", content: {}, seoTitle: null, seoDescription: null, updatedAt: new Date(), published: true };
    expect(buildComparison(a, b, null).indexable).toBe(false);
    expect(buildComparison(a, b, written).indexable).toBe(true);
    expect(buildComparison(a, b, { ...written, published: false }).indexable).toBe(false);
    expect(buildComparison(a, platform({ slug: "ziki", isZiki: true }), null).indexable).toBe(true);
  });
});

describe("the admin form's accuracy rules", () => {
  it("refuses a verified answer with no source, a 'not available' with no note, and verified answers with no date", () => {
    expect(parsePlatformForm(platformForm({ "feature.pricing.status": "available" }))).toMatchObject({ ok: false });
    const noNote = parsePlatformForm(platformForm({ "feature.pricing.status": "not_available", "feature.pricing.sourceUrl": "https://acme.example/pricing", lastVerifiedAt: "2026-11-05" }));
    expect(noNote).toMatchObject({ ok: false });
    const noDate = parsePlatformForm(platformForm({ "feature.pricing.status": "available", "feature.pricing.sourceUrl": "https://acme.example/pricing" }));
    expect(noDate).toMatchObject({ ok: false });
  });

  it("accepts a sourced, dated answer and keeps unchecked rows out of the stored features", () => {
    const result = parsePlatformForm(
      platformForm({ "feature.pricing.status": "available", "feature.pricing.note": "Free tier.", "feature.pricing.sourceUrl": "https://acme.example/pricing", lastVerifiedAt: "2026-11-05" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data.features)).toEqual(["pricing"]);
      expect(result.data.lastVerifiedAt?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    }
  });
});

describe("who can change the directory", () => {
  beforeEach(() => {
    create.mockReset();
    requireSuperAdmin.mockReset();
  });

  it("writes nothing when the caller isn't a super admin", async () => {
    requireSuperAdmin.mockRejectedValue(new Error("forbidden"));
    const { savePlatformAction } = await import("@/app/(app)/superadmin/compare/actions");
    await expect(savePlatformAction({}, platformForm({}))).rejects.toThrow("forbidden");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("the starting catalogue", () => {
  it("has valid, unique slugs and puts no unchecked claims on a competitor", () => {
    const slugs = COMPARE_BASELINE.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of COMPARE_BASELINE) {
      expect(isValidPlatformSlug(p.slug), p.slug).toBe(true);
      if (p.isZiki) continue;
      expect(p.features ?? {}, p.slug).toEqual({});
      expect(p.limitations ?? [], p.slug).toEqual([]);
      expect(p.pricingSummary, p.slug).toBeUndefined();
      expect(p.lastVerifiedAt, p.slug).toBeUndefined();
    }
  });

  it("gives every verified Ziki answer a source", () => {
    const ziki = COMPARE_BASELINE.find((p) => p.isZiki);
    for (const [key, entry] of Object.entries(ziki?.features ?? {})) {
      if (entry.status !== "not_verified") expect(entry.sourceUrl, key).toBeTruthy();
    }
  });
});
