"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { refererProjectRef } from "@/lib/referer-path";
import { orgPath } from "@/lib/project-paths";
import { redactAlert, resolveAlert, scanOrganisationPosts } from "@/lib/security/secret-scan";
import { loadOrg } from "../org-context";

/**
 * The Secret alerts page's actions (#secret-protection). Owners and admins
 * only: an alert names who posted what, and its actions change posts.
 */

/** A scan reads a lot of text, so an organisation may start one a few times an hour. */
const SCAN_RATE_LIMIT = { max: 12, windowMs: 10 * 60 * 1000 };

async function back(query: Record<string, string>): Promise<never> {
  const ref = await refererProjectRef();
  const params = new URLSearchParams(query);
  redirect(ref ? `${orgPath(ref, "secrets")}?${params}` : "/home");
}

async function requireOrgAdmin() {
  const { user, org } = await loadOrg();
  if (!org || !org.admin) await back({ error: "Only the organisation's owners and admins can do that." });
  return { user, org: org! };
}

/** Reads the organisation's posts for secrets already up, from where the last scan stopped. */
export async function scanSecretsAction(formData: FormData): Promise<void> {
  const { user, org } = await requireOrgAdmin();
  if (!(await consumeRateLimit(`secret-scan:${org.id}`, SCAN_RATE_LIMIT)).allowed) {
    await back({ error: RATE_LIMIT_MESSAGE });
  }
  const cursor = String(formData.get("cursor") ?? "") || null;
  const result = await scanOrganisationPosts(org.id, user.id, cursor);
  const found = result.found === 1 ? "1 new secret" : `${result.found} new secrets`;
  const keys = result.revokedKeys ? ` Ziki turned off ${result.revokedKeys === 1 ? "1 agent key" : `${result.revokedKeys} agent keys`} and told the owners.` : "";
  revalidatePath("/[org]/[project]/org/secrets", "page");
  await back({
    notice: result.next
      ? `Read ${result.scanned.toLocaleString("en")} posts and found ${found} so far.${keys} Carry on to read the rest.`
      : `Read every post and found ${found}.${keys}`,
    ...(result.next ? { cursor: result.next } : {}),
  });
}

/** Removes an alert's secret from its post and the post's earlier versions. */
export async function redactSecretAction(formData: FormData): Promise<void> {
  const { user, org } = await requireOrgAdmin();
  const result = await redactAlert(org.id, String(formData.get("alertId") ?? ""), user.id);
  if (!result.ok) await back({ error: result.error });
  revalidatePath("/[org]/[project]", "layout");
  await back({
    notice: result.ok && result.removed > 0
      ? "Removed from the post and its history. Turn the secret off where it was made too: anyone who saw it may still have it."
      : "It was no longer in the post, so nothing changed. The alert is closed.",
  });
}

/** Closes an alert by hand: the secret was turned off, or it was never a real one. */
export async function resolveSecretAlertAction(formData: FormData): Promise<void> {
  const { user, org } = await requireOrgAdmin();
  const state = String(formData.get("state") ?? "") === "dismissed" ? "dismissed" : "revoked";
  const ok = await resolveAlert(org.id, String(formData.get("alertId") ?? ""), user.id, state);
  if (!ok) await back({ error: "That alert is already closed." });
  revalidatePath("/[org]/[project]/org/secrets", "page");
  await back({ notice: state === "dismissed" ? "Marked as not a real secret." : "Marked as turned off." });
}
