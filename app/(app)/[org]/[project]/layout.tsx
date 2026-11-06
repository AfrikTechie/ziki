import { prisma } from "@/lib/prisma";
import { optionalUser } from "@/lib/auth-helpers";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { ProjectBreadcrumb } from "@/components/project-breadcrumb";

/**
 * A project's pages, with the slot for routes shown over them (#report-modal).
 * The quick report intercepts `issues/new` here, under the project, rather
 * than intercepting `[org]/[project]` from the app layout: intercepting a dynamic
 * top-level segment made Next rewrite the path into itself in a loop.
 *
 * Every project page starts with the breadcrumb (#no-platforms): All Projects,
 * project and page. It only reads: each page checks access and switches
 * organisation itself (lib/project-route.ts), keeping its own address.
 */
export default async function ProjectLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  /** Intercepted routes shown over the page, e.g. the quick report. */
  modal: React.ReactNode;
  params: Promise<{ org: string; project: string }>;
}) {
  const { org, project: slug } = await params;
  const user = await optionalUser();
  const organisationId = user ? await currentOrganisationIdFor(user.id) : null;
  const project = organisationId
    ? await prisma.project.findFirst({
        where: { organisationId, slug: decodeURIComponent(slug), archivedAt: null, organisation: { slug: decodeURIComponent(org), memberships: { some: { userId: user!.id } } } },
        select: { slug: true, name: true, organisation: { select: { slug: true } } },
      })
    : null;
  // Not this organisation's project (yet): the page switches organisation or 404s.
  if (!project) return <>{children}{modal}</>;
  return (
    <>
      <ProjectBreadcrumb project={{ orgSlug: project.organisation.slug, slug: project.slug, name: project.name }} />
      {children}
      {modal}
    </>
  );
}
