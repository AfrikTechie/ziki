import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { marketingPath } from "@/lib/project-paths";
import { firstProjectRefFor } from "@/lib/project-route";

export const metadata = { title: "Marketing" };

/** `/marketing` names no project: it opens the current project's section. */
export default async function MarketingPage() {
  const user = await requireUser();
  const slug = await firstProjectRefFor(user.id);
  redirect(slug ? marketingPath(slug) : "/organisations");
}
