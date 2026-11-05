import { prisma } from "@/lib/prisma";
import { optionalUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { ProjectBreadcrumb } from "@/components/project-breadcrumb";

/**
 * A project's pages, with the slot for routes shown over them (#report-modal).
 * The quick report intercepts `issues/new` here, under the project, rather
 * than intercepting `[org]/[project]` from the app layout: intercepting a dynamic
 * top-level segment made Next rewrite the path into itself in a loop.
 *
 * Every project page starts with the breadcrumb (#no-platforms): All Projects,
 * project and page. It only reads: each page checks access and switches
 * workspace itself (lib/project-route.ts), keeping its own address.
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
  const tenantId = user ? await currentTenantIdFor(user.id) : null;
  const project = tenantId
    ? await prisma.project.findFirst({
        where: { tenantId, slug: decodeURIComponent(slug), archivedAt: null, tenant: { slug: decodeURIComponent(org), memberships: { some: { userId: user!.id } } } },
        select: { slug: true, name: true, tenant: { select: { slug: true } } },
      })
    : null;
  // Not this workspace's project (yet): the page switches workspace or 404s.
  if (!project) return <>{children}{modal}</>;
  return (
    <>
      <ProjectBreadcrumb project={{ orgSlug: project.tenant.slug, slug: project.slug, name: project.name }} />
      {children}
      {modal}
    </>
  );
}
