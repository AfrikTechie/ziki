import { createHmac, timingSafeEqual } from "node:crypto";

/** True when `signature` (GitHub's X-Hub-Signature-256 header) signs `body` with `secret` (#github-status). */
export function signatureMatches(body: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
