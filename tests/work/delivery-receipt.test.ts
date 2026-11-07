import { describe, expect, it } from "vitest";
import { deliveryReceiptSchema, receiptSummary, storedReceipt } from "@/lib/delivery-receipt";

/** The delivery receipt (#delivery-receipt): what was verified, what was not, and what the reviewer should test. */
const receipt = {
  verified: [{ check: "node --test (3/3)", how: "ran on f46960b" }, { check: "prettier clean" }],
  notVerified: [{ check: "Manual race in a real browser", why: "no preview deployment" }],
  reviewerShould: ["Open the preview, search two names", "Hold the first response, release it last"],
};

describe("deliveryReceiptSchema", () => {
  it("takes verified rows with how, not-verified rows with why, and reviewer steps", () => {
    const parsed = deliveryReceiptSchema.safeParse(receipt);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(receipt);
  });

  it("fills the lists it is not given, as long as one of verified or notVerified is there", () => {
    const parsed = deliveryReceiptSchema.safeParse({ verified: [{ check: "pnpm test" }] });
    expect(parsed.success && parsed.data).toEqual({ verified: [{ check: "pnpm test" }], notVerified: [], reviewerShould: [] });
  });

  it("refuses an empty receipt, naming verified", () => {
    const parsed = deliveryReceiptSchema.safeParse({ reviewerShould: ["Run the tests"] });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0]?.path).toEqual(["verified"]);
  });

  it("refuses unknown keys, blank lines, lines over 300 characters and more than 20 rows", () => {
    expect(deliveryReceiptSchema.safeParse({ ...receipt, extra: true }).success).toBe(false);
    expect(deliveryReceiptSchema.safeParse({ verified: [{ check: "  " }] }).success).toBe(false);
    expect(deliveryReceiptSchema.safeParse({ verified: [{ check: "x".repeat(301) }] }).success).toBe(false);
    expect(deliveryReceiptSchema.safeParse({ verified: Array.from({ length: 21 }, () => ({ check: "ok" })) }).success).toBe(false);
    expect(deliveryReceiptSchema.safeParse({ verified: [{ check: "ok", why: "wrong key" }] }).success).toBe(false);
  });
});

describe("storedReceipt", () => {
  it("reads a stored receipt back, and gives null for none or an unreadable one", () => {
    expect(storedReceipt(receipt)).toEqual(receipt);
    expect(storedReceipt(null)).toBeNull();
    expect(storedReceipt("verified")).toBeNull();
    expect(storedReceipt([])).toBeNull();
    expect(storedReceipt({ verified: "yes" })).toBeNull();
  });
});

describe("receiptSummary", () => {
  it("counts the rows in one line, with the steps only when there are any", () => {
    expect(receiptSummary(receipt)).toBe("2 verified · 1 not verified · 2 steps to test");
    expect(receiptSummary({ verified: [], notVerified: [{ check: "x" }], reviewerShould: ["one"] })).toBe("0 verified · 1 not verified · 1 step to test");
    expect(receiptSummary({ verified: [{ check: "x" }], notVerified: [], reviewerShould: [] })).toBe("1 verified · 0 not verified");
  });
});
