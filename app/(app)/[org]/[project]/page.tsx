import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/project-route";
import { projectHomePath } from "@/lib/marketing/project-home";

type Props = { params: Promise<{ org: string; project: string }> };

/**
 * `/<org>/<project>`: the project's home (#project-urls): its Ideas list, or its
 * Marketing tab when the project is all marketing (#marketing-home). The
 * address picks the project and lib/project-route.ts checks access: a project
 * you can't see is a 404, like any unknown address.
 */
export default async function ProjectHomePage({ params }: Props) {
  const { org, project: slug } = await params;
  const { project } = await requireProject(org, slug);
  redirect(await projectHomePath(prisma, project.id, project.ref));
}
