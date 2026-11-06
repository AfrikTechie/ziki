/**
 * Per-organisation dismissals kept in a cookie on this device, such as the
 * next-step card's (lib/organisation-next-step.ts).
 */

/** Most organisation ids the cookie keeps, so it can't grow without bound. */
const MAX_DISMISSED = 50;

/** Organisation ids dismissed on this device. */
export function parseDismissed(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))
    .slice(-MAX_DISMISSED);
}

/** The cookie value after dismissing `organisationId`, newest last, capped. */
export function withDismissed(value: string | null | undefined, organisationId: string): string {
  const ids = parseDismissed(value).filter((id) => id !== organisationId);
  ids.push(organisationId);
  return ids.slice(-MAX_DISMISSED).join(",");
}
