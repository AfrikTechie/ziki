import { revalidatePath } from "next/cache";

/**
 * Refreshes an issue's pages after a change. Pages are served at the project
 * URL (`/<org>/<project>/<number>`, #project-urls) while actions know the
 * internal id, so the route pattern is revalidated.
 */
export function revalidateIssue(): void {
  revalidatePath("/[org]/[project]/[number]", "layout");
}
