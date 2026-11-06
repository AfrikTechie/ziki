/**
 * Per-workspace dismissals kept in a cookie on this device, such as the
 * next-step card's (lib/workspace-next-step.ts).
 */

/** Most workspace ids the cookie keeps, so it can't grow without bound. */
const MAX_DISMISSED = 50;

/** Workspace ids dismissed on this device. */
export function parseDismissed(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))
    .slice(-MAX_DISMISSED);
}

/** The cookie value after dismissing `tenantId`, newest last, capped. */
export function withDismissed(value: string | null | undefined, tenantId: string): string {
  const ids = parseDismissed(value).filter((id) => id !== tenantId);
  ids.push(tenantId);
  return ids.slice(-MAX_DISMISSED).join(",");
}
