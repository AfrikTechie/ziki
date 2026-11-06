"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { parseComparisonForm, parsePlatformForm } from "@/lib/compare/admin-form";
import { formDataToValues, type FormValues } from "@/lib/compare/admin-values";
import { canonicalPair, comparisonSlug, ZIKI_SLUG } from "@/lib/compare/slug";

export type CompareFormState = { error?: string; values?: FormValues };

const LIST = "/superadmin/compare";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Public pages read the database on every request; only the admin list is cached. */
function refresh() {
  revalidatePath(LIST);
}

export async function savePlatformAction(_prev: CompareFormState, formData: FormData): Promise<CompareFormState> {
  await requireSuperAdmin();
  const values = formDataToValues(formData);
  const parsed = parsePlatformForm(formData);
  if (!parsed.ok) return { error: parsed.error, values };
  const data = parsed.data;
  const id = String(formData.get("id") ?? "");

  try {
    const fields = { ...data, features: data.features as unknown as Prisma.InputJsonObject };
    if (id) {
      const existing = await prisma.comparePlatform.findUnique({ where: { id }, select: { slug: true, isZiki: true } });
      if (!existing) return { error: "That platform no longer exists.", values };
      if (existing.isZiki && data.slug !== ZIKI_SLUG) return { error: "Ziki's slug is fixed: comparison URLs put Ziki first by it.", values };
      await prisma.$transaction(async (tx) => {
        await tx.comparePlatform.update({ where: { id }, data: fields });
        if (existing.slug !== data.slug) {
          // A comparison's URL is made of its platforms' slugs, so renaming one renames its pages.
          const pairs = await tx.comparison.findMany({
            where: { OR: [{ platformAId: id }, { platformBId: id }] },
            select: { id: true, platformA: { select: { slug: true } }, platformB: { select: { slug: true } } },
          });
          for (const pair of pairs) {
            const order = canonicalPair(pair.platformA.slug, pair.platformB.slug);
            await tx.comparison.update({ where: { id: pair.id }, data: { slug: comparisonSlug(order.a, order.b) } });
          }
        }
      });
    } else {
      await prisma.comparePlatform.create({ data: fields });
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { error: `Another platform already uses the slug “${data.slug}”.`, values };
    console.error("[admin/compare] platform save failed", error);
    return { error: "Could not save the platform. Try again.", values };
  }
  refresh();
  redirect(`${LIST}?saved=platform`);
}

export async function saveComparisonAction(_prev: CompareFormState, formData: FormData): Promise<CompareFormState> {
  await requireSuperAdmin();
  const values = formDataToValues(formData);
  const parsed = parseComparisonForm(formData);
  if (!parsed.ok) return { error: parsed.error, values };
  const data = parsed.data;
  const id = String(formData.get("id") ?? "");

  const platforms = await prisma.comparePlatform.findMany({
    where: { id: { in: [data.platformAId, data.platformBId] } },
    select: { id: true, slug: true },
  });
  const first = platforms.find((p) => p.id === data.platformAId);
  const second = platforms.find((p) => p.id === data.platformBId);
  if (!first || !second) return { error: "One of the platforms no longer exists.", values };

  // Stored in the canonical order, so the page's "A" is always the platform it shows first.
  const order = canonicalPair(first.slug, second.slug);
  const [a, b] = order.a === first.slug ? [first, second] : [second, first];
  // The editorial text is written against the order the admin saw; swap it when that order differs.
  const swapped = a.id !== data.platformAId;
  const content = swapped
    ? {
        ...data.content,
        details: data.content.details?.map((d) => ({ ...d, a: d.b, b: d.a })),
        strengthsA: data.content.strengthsB,
        strengthsB: data.content.strengthsA,
        limitationsA: data.content.limitationsB,
        limitationsB: data.content.limitationsA,
        recommendations: data.content.recommendations?.map((r) => ({ ...r, pick: r.pick === "a" ? ("b" as const) : r.pick === "b" ? ("a" as const) : r.pick })),
      }
    : data.content;

  const fields = {
    slug: comparisonSlug(a.slug, b.slug),
    platformAId: a.id,
    platformBId: b.id,
    title: data.title,
    summary: data.summary,
    content: content as Prisma.InputJsonObject,
    seoTitle: data.seoTitle,
    seoDescription: data.seoDescription,
    popular: data.popular,
    published: data.published,
  };

  try {
    if (id) await prisma.comparison.update({ where: { id }, data: fields });
    else await prisma.comparison.create({ data: fields });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "A comparison for this pair already exists. Edit that one instead.", values };
    console.error("[admin/compare] comparison save failed", error);
    return { error: "Could not save the comparison. Try again.", values };
  }
  refresh();
  redirect(`${LIST}?saved=comparison`);
}

/** Publish or unpublish a platform or a comparison from the list. */
export async function setPublishedAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");
  const published = formData.get("published") === "true";
  if (!id) return;
  if (kind === "platform") {
    const row = await prisma.comparePlatform.findUnique({ where: { id }, select: { isZiki: true } });
    // Ziki is the anchor of the directory; unpublishing it would take every Ziki comparison down.
    if (!row || (row.isZiki && !published)) return;
    await prisma.comparePlatform.update({ where: { id }, data: { published } });
  } else if (kind === "comparison") {
    await prisma.comparison.update({ where: { id }, data: { published } });
  }
  refresh();
}
