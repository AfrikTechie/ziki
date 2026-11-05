import { headers } from "next/headers";
import { BASE_PATH } from "@/lib/base-path";
import { isProjectFirstPath, projectRef, type ProjectRef } from "@/lib/project-paths";
import { isReservedProjectSlug } from "@/lib/project-slug";

/**
 * The in-app path of the page a server action was submitted from (#project-urls),
 * from the Referer header, or null. Actions use it to send people back to the
 * project page they were on, since the project is in that page's URL.
 */
export async function refererPath(): Promise<string | null> {
  try {
    const referer = (await headers()).get("referer");
    if (!referer) return null;
    const url = new URL(referer);
    const path = BASE_PATH && url.pathname.startsWith(BASE_PATH) ? url.pathname.slice(BASE_PATH.length) || "/" : url.pathname;
    return path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

/** The project of the page an action came from (`/<org>/<project>/…`), or null. */
export async function refererProjectRef(): Promise<ProjectRef | null> {
  const path = await refererPath();
  if (!path || isProjectFirstPath(path)) return null;
  const [org, project] = path.split("?")[0].split("/").filter(Boolean);
  if (!org || !project || isReservedProjectSlug(decode(org))) return null;
  return projectRef(decode(org), decode(project));
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
