import { z } from "zod";

/**
 * The hand-written part of a comparison (`Comparison.content`). Everything is
 * optional: a pair without it is built from the two platforms' own data.
 */
export const comparisonContentSchema = z.object({
  intro: z.string().max(1200).optional(),
  details: z
    .array(z.object({ heading: z.string().min(1).max(120), a: z.string().max(800), b: z.string().max(800) }))
    .max(12)
    .optional(),
  strengthsA: z.array(z.string().min(1).max(300)).max(10).optional(),
  limitationsA: z.array(z.string().min(1).max(300)).max(10).optional(),
  strengthsB: z.array(z.string().min(1).max(300)).max(10).optional(),
  limitationsB: z.array(z.string().min(1).max(300)).max(10).optional(),
  recommendations: z
    .array(
      z.object({
        useCase: z.string().min(1).max(200),
        pick: z.enum(["a", "b", "either"]),
        note: z.string().max(400).optional(),
      }),
    )
    .max(12)
    .optional(),
});

export type ComparisonContent = z.infer<typeof comparisonContentSchema>;

/** Stored content that no longer parses reads as empty, so a bad edit can't take a page down. */
export function readComparisonContent(raw: unknown): ComparisonContent {
  const parsed = comparisonContentSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}
