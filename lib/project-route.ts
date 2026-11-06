import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { orgHomePath, projectPath, projectRef, type ProjectRef } from "@/lib/project-paths";

/**
 * The project a page shows comes from its URL, `/<org>/<project>/…`
 * (#project-urls), never a cookie. This resolves it and is the access check
 * for every project page:
 *
 * - The organisation slug is looked up among the organisations the signed-in
 *   person belongs to (any for the site super admin), and the project slug
 *   inside it. No match is a 404, so a project you can't see looks the same
 *   as one that doesn't exist.
 * - When the organisation isn't the current one, the request goes through
 *   /projects/<slug>/open, which makes it current and comes back, so
 *   everything the page and its actions read agrees with the URL.
 */
export type ProjectContext = {
  user: Awaited<ReturnType<typeof requireUser>>;
  tenantId: string;
  project: { id: string; slug: string; name: string; goal: string | null; tenantId: string; orgSlug: string; ref: ProjectRef };
};

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** This request's own address (path and query), set by middleware.ts, to come back to after switching organisation. */
async function requestPath(fallback: string): Promise<string> {
  const path = (await headers()).get("x-ziki-url");
  return path && path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

/** The organisations someone may open: null means any (the site super admin). */
async function openableTenantIds(user: { id: string; role: string }): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  const memberships = await prisma.membership.findMany({ where: { userId: user.id, tenant: { archivedAt: null } }, select: { tenantId: true } });
  return memberships.map((m) => m.tenantId);
}

function switchTo(tenantId: string, projectSlug: string, next: string): never {
  redirect(`/projects/${encodeURIComponent(projectSlug)}/open?tenant=${encodeURIComponent(tenantId)}&next=${encodeURIComponent(next)}`);
}

export const requireProject = cache(async (orgParam: string, projectParam: string): Promise<ProjectContext> => {
  const user = await requireUser();
  const orgSlug = decode(orgParam);
  const slug = decode(projectParam);
  const tenantIds = await openableTenantIds(user);
  if (tenantIds && tenantIds.length === 0) notFound();

  const project = await prisma.project.findFirst({
    where: { slug, archivedAt: null, tenant: { slug: orgSlug, archivedAt: null }, ...(tenantIds ? { tenantId: { in: tenantIds } } : {}) },
    select: { id: true, slug: true, name: true, goal: true, tenantId: true },
  });
  if (!project) notFound();

  const ref = projectRef(orgSlug, project.slug);
  if (project.tenantId !== (await currentTenantIdFor(user.id))) {
    // Switch to the project's organisation first, then come back to this page.
    switchTo(project.tenantId, project.slug, await requestPath(projectPath(ref)));
  }
  return { user, tenantId: project.tenantId, project: { ...project, orgSlug, ref } };
});

/**
 * `/<org>`: the organisation an address names, checked the same way as a
 * project, made current if it isn't. Null when the person isn't in it.
 */
export const requireOrg = cache(async (orgParam: string) => {
  const user = await requireUser();
  const orgSlug = decode(orgParam);
  const tenantIds = await openableTenantIds(user);
  const tenant = await prisma.tenant.findFirst({
    where: { slug: orgSlug, archivedAt: null, ...(tenantIds ? { id: { in: tenantIds } } : {}) },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) return { user, tenant: null };
  if (tenant.id !== (await currentTenantIdFor(user.id))) {
    // Through /tenants/open, which works for an organisation with no projects yet.
    redirect(`/tenants/open?tenant=${encodeURIComponent(tenant.id)}&next=${encodeURIComponent(await requestPath(orgHomePath(tenant.slug)))}`);
  }
  return { user, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
});

/**
 * Where an address from before organisations were in URLs now lives
 * (`/<project>/…` → `/<org>/<project>/…`, #project-urls), or null. The first
 * segment is the project's slug, looked up in the person's organisations (the
 * current one first); when no project has it but one of their organisations
 * does, that organisation's default project. The rest of the address is kept.
 */
export async function projectFirstTarget(user: { id: string; role: string }, path: string): Promise<string | null> {
  const queryAt = path.indexOf("?");
  const pathname = queryAt < 0 ? path : path.slice(0, queryAt);
  const query = queryAt < 0 ? "" : path.slice(queryAt);
  const [first, ...rest] = pathname.split("/").filter(Boolean);
  if (!first) return null;
  const slug = decode(first);
  const tenantIds = await openableTenantIds(user);
  const scope = { archivedAt: null, ...(tenantIds ? { id: { in: tenantIds } } : {}) };
  const currentTenantId = await currentTenantIdFor(user.id);

  const projects = await prisma.project.findMany({
    where: { slug, archivedAt: null, tenant: scope },
    select: { slug: true, tenantId: true, tenant: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  const project = projects.find((p) => p.tenantId === currentTenantId) ?? projects[0];
  let ref: ProjectRef | null = project ? projectRef(project.tenant.slug, project.slug) : null;
  if (!ref) {
    const tenant = await prisma.tenant.findFirst({ where: { slug, ...scope }, select: { id: true, slug: true } });
    const first = tenant ? await defaultProjectSlug(tenant.id) : null;
    if (tenant && first) ref = projectRef(tenant.slug, first);
  }
  if (!ref) return null;
  // The organisation's projects page was `/<project>/projects`; it is `/<org>` now.
  if (rest[0] === "projects") return `/${ref.split("/")[0]}${query}`;
  return `${projectPath(ref, rest.length ? `/${rest.join("/")}` : "")}${query}`;
}

const DEFAULT_PROJECT_SLUG = "web";

/** The project an organisation opens on when none is named: Web when it has one, else its oldest (#no-general). */
async function defaultProjectSlug(tenantId: string): Promise<string | null> {
  const web = await prisma.project.findFirst({ where: { tenantId, archivedAt: null, slug: DEFAULT_PROJECT_SLUG }, select: { slug: true } });
  if (web) return web.slug;
  const oldest = await prisma.project.findFirst({ where: { tenantId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { slug: true } });
  return oldest?.slug ?? null;
}

/** The first project someone can open, for addresses with no project (the site root, sign-in). */
export async function firstProjectRefFor(userId: string): Promise<ProjectRef | null> {
  const tenantId = await currentTenantIdFor(userId);
  if (!tenantId) return null;
  const [tenant, slug] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }),
    defaultProjectSlug(tenantId),
  ]);
  return tenant && slug ? projectRef(tenant.slug, slug) : null;
}

/** The current organisation's Projects page, for someone whose organisation has no projects yet. */
export async function currentOrgPathFor(userId: string): Promise<string | null> {
  const tenantId = await currentTenantIdFor(userId);
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId, archivedAt: null }, select: { slug: true } });
  return tenant ? orgHomePath(tenant.slug) : null;
}
