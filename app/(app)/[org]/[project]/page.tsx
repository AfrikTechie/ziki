import { redirect } from "next/navigation";
import { requireProject } from "@/lib/project-route";
import { ideasPath } from "@/lib/project-paths";

type Props = { params: Promise<{ org: string; project: string }> };

/**
 * `/<org>/<project>`: the project's home, its Ideas list (#project-urls). The
 * address picks the project and lib/project-route.ts checks access: a project
 * you can't see is a 404, like any unknown address.
 */
export default async function ProjectHomePage({ params }: Props) {
  const { org, project: slug } = await params;
  const { project } = await requireProject(org, slug);
  redirect(ideasPath(project.ref));
}
