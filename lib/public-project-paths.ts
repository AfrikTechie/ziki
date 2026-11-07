export type PublicProjectRef = { orgSlug: string; projectSlug: string };

export function publicProjectPath(ref: PublicProjectRef): string {
  return `/${encodeURIComponent(ref.orgSlug)}/${encodeURIComponent(ref.projectSlug)}`;
}

export function publicReportPath(ref: PublicProjectRef): string {
  return `${publicProjectPath(ref)}/report`;
}

export function publicTrackingPath(ref: PublicProjectRef, token: string): string {
  return `${publicProjectPath(ref)}/track/${encodeURIComponent(token)}`;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Guest-only intake pages nested below the existing public project overview. */
export function publicIntakeSegments(
  path: string,
): (PublicProjectRef & { kind: "report" | "track" }) | null {
  const match = /^\/([^/]+)\/([^/]+)\/(report|track\/[^/]+)\/?$/.exec(path);
  if (!match) return null;
  const orgSlug = decodeSegment(match[1] ?? "");
  const projectSlug = decodeSegment(match[2] ?? "");
  if (!orgSlug || !projectSlug) return null;
  return {
    orgSlug,
    projectSlug,
    kind: match[3] === "report" ? "report" : "track",
  };
}
