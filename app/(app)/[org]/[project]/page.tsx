import { notFound } from "next/navigation";
import { ProjectOverviewView } from "@/components/project-overview";
import { optionalUser } from "@/lib/auth-helpers";
import { requireProject } from "@/lib/project-route";
import { loadProjectOverview } from "@/lib/project-overview";
import { projectHomePath } from "@/lib/marketing/project-home";
import { projectRef } from "@/lib/project-paths";
import { prisma } from "@/lib/prisma";

type Props = { params: Promise<{ org: string; project: string }> };

/**
 * `/<org>/<project>`: the project's home (#project-urls): its Ideas list, or its
 * Marketing tab when the project is all marketing (#marketing-home). The
 * address picks the project and lib/project-route.ts checks access: a project
 * you can't see is a 404, like any unknown address.
 */
export default async function ProjectOverviewPage({ params }: Props) {
  const { org, project: slug } = await params;
  const user = await optionalUser();
  if (user) await requireProject(org, slug);
  const data = await loadProjectOverview(org, slug, user);
  if (!data) notFound();

  // A member's way into the work is where the project used to open: its
  // Marketing tab when it is all marketing, else its Ideas (#marketing-home).
  const workHref = data.isMember
    ? await projectHomePath(prisma, data.project.id, projectRef(data.project.organisation.slug, data.project.slug))
    : null;

  return <ProjectOverviewView data={data} currentUserId={user?.id ?? null} workHref={workHref} />;
}
