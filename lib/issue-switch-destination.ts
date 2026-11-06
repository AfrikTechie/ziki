/** Preserve an issue's query/anchor, never a client-selected destination. */
export function issueSwitchDestination(canonical: string, requested: unknown): string {
  if (typeof requested !== "string" || requested.length > 8192 || !requested.startsWith("/") || requested.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(requested)) return canonical;
  try {
    const origin = "https://ziki.invalid";
    const target = new URL(requested, origin);
    const issue = new URL(canonical, origin);
    if (target.origin !== origin || target.pathname !== issue.pathname) return canonical;
    return `${issue.pathname}${target.search}${target.hash}`;
  } catch { return canonical; }
}
