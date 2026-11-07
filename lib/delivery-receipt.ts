import { z } from "zod";

/**
 * The delivery receipt (#delivery-receipt): the part of a delivery that tells
 * a reviewer where to look. The agent that delivers says what it verified and
 * how, what it did not verify and why, and what the reviewer should test. It
 * is stored on the delivery as JSON, shown on the issue under the delivery,
 * and handed to testers with `GET /api/v1/issues/{id}/test-results`, so a
 * judgement answers the receipt instead of guessing what to check.
 *
 * Pure: no database. The server side reads and writes it in
 * lib/agent-api/delivery.ts; the issue page renders it in
 * components/issue-review-entries.tsx.
 */

const RECEIPT_LINE = 300;
const RECEIPT_ITEMS = 20;

const line = z.string().trim().min(1).max(RECEIPT_LINE);

/** Something the deliverer checked, and how (a command, a browser, a device). */
const verifiedItem = z.object({ check: line, how: line.optional() }).strict();
/** Something the deliverer could not or did not check, and why. */
const notVerifiedItem = z.object({ check: line, why: line.optional() }).strict();

export const deliveryReceiptSchema = z
  .object({
    /** What was checked, each with how it was checked. */
    verified: z.array(verifiedItem).max(RECEIPT_ITEMS).default([]),
    /** What was left unchecked, each with why. */
    notVerified: z.array(notVerifiedItem).max(RECEIPT_ITEMS).default([]),
    /** What the reviewer should do to judge the work, in order. */
    reviewerShould: z.array(line).max(RECEIPT_ITEMS).default([]),
  })
  .strict()
  .refine((receipt) => receipt.verified.length + receipt.notVerified.length > 0, {
    message: "A receipt says what was verified or what was not: send at least one of verified or notVerified.",
    path: ["verified"],
  });

export type DeliveryReceipt = z.infer<typeof deliveryReceiptSchema>;

/** The receipt as stored (a JSON column), or null when there is none or it is unreadable. */
export function storedReceipt(value: unknown): DeliveryReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = deliveryReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** One line for a feed or a banner: "3 verified · 1 not verified · 2 steps to test". */
export function receiptSummary(receipt: DeliveryReceipt): string {
  const parts = [
    `${receipt.verified.length} verified`,
    `${receipt.notVerified.length} not verified`,
  ];
  if (receipt.reviewerShould.length) {
    parts.push(`${receipt.reviewerShould.length} step${receipt.reviewerShould.length === 1 ? "" : "s"} to test`);
  }
  return parts.join(" · ");
}
