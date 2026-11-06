import { COMPARE_DIMENSIONS, featureOf } from "./catalog";
import { readComparisonContent } from "./content";

/** A form's fields as plain strings, so the same shape fills a form from the database or from a failed submit. */
export type FormValues = Record<string, string>;

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export function platformToValues(p: {
  id: string;
  slug: string;
  name: string;
  category: string;
  websiteUrl: string;
  logoUrl: string | null;
  description: string;
  useCases: string[];
  strengths: string[];
  limitations: string[];
  pricingSummary: string | null;
  sourceUrls: string[];
  features: unknown;
  lastVerifiedAt: Date | null;
  popular: boolean;
  published: boolean;
  sortOrder: number;
}): FormValues {
  const values: FormValues = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    websiteUrl: p.websiteUrl,
    logoUrl: p.logoUrl ?? "",
    description: p.description,
    useCases: p.useCases.join("\n"),
    strengths: p.strengths.join("\n"),
    limitations: p.limitations.join("\n"),
    pricingSummary: p.pricingSummary ?? "",
    sourceUrls: p.sourceUrls.join("\n"),
    lastVerifiedAt: isoDay(p.lastVerifiedAt),
    popular: p.popular ? "on" : "",
    published: p.published ? "on" : "",
    sortOrder: String(p.sortOrder),
  };
  for (const d of COMPARE_DIMENSIONS) {
    const f = featureOf(p.features, d.key);
    values[`feature.${d.key}.status`] = f.status;
    values[`feature.${d.key}.note`] = f.note ?? "";
    values[`feature.${d.key}.sourceUrl`] = f.sourceUrl ?? "";
  }
  return values;
}

export const EMPTY_PLATFORM: FormValues = platformToValues({
  id: "",
  slug: "",
  name: "",
  category: "agent_platform",
  websiteUrl: "https://",
  logoUrl: null,
  description: "",
  useCases: [],
  strengths: [],
  limitations: [],
  pricingSummary: null,
  sourceUrls: [],
  features: {},
  lastVerifiedAt: null,
  popular: false,
  published: false,
  sortOrder: 100,
});

export function comparisonToValues(c: {
  id: string;
  platformAId: string;
  platformBId: string;
  title: string;
  summary: string | null;
  content: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  popular: boolean;
  published: boolean;
}): FormValues {
  const content = readComparisonContent(c.content);
  return {
    id: c.id,
    platformAId: c.platformAId,
    platformBId: c.platformBId,
    title: c.title,
    summary: c.summary ?? "",
    intro: content.intro ?? "",
    details: (content.details ?? []).map((d) => `${d.heading} | ${d.a} | ${d.b}`).join("\n"),
    strengthsA: (content.strengthsA ?? []).join("\n"),
    limitationsA: (content.limitationsA ?? []).join("\n"),
    strengthsB: (content.strengthsB ?? []).join("\n"),
    limitationsB: (content.limitationsB ?? []).join("\n"),
    recommendations: (content.recommendations ?? []).map((r) => `${r.useCase} | ${r.pick}${r.note ? ` | ${r.note}` : ""}`).join("\n"),
    seoTitle: c.seoTitle ?? "",
    seoDescription: c.seoDescription ?? "",
    popular: c.popular ? "on" : "",
    published: c.published ? "on" : "",
  };
}

export const EMPTY_COMPARISON: FormValues = comparisonToValues({
  id: "",
  platformAId: "",
  platformBId: "",
  title: "",
  summary: null,
  content: {},
  seoTitle: null,
  seoDescription: null,
  popular: false,
  published: false,
});

export function formDataToValues(fd: FormData): FormValues {
  const out: FormValues = {};
  for (const [key, value] of fd.entries()) if (typeof value === "string") out[key] = value;
  return out;
}
