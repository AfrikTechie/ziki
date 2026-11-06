import { randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { awardSignupBonus } from "@/lib/points/signup-bonus";
import { unstable_rethrow } from "next/navigation";
import type { MembershipRole, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isSuperAdmin, type AppRole } from "@/lib/roles";
import { ZEDU_SLUG } from "@/lib/tenant";
import { appCookieOptions } from "@/lib/cookie-options";
import { isReservedProjectSlug } from "@/lib/project-slug";

/**
 * Picking, creating and owning tenants (#444).
 *
 * After sign-in a person works inside one tenant: one they already belong
 * to, one they create, or one they were invited to (lib/invites.ts). A
 * membership is the only way in. Nothing here adds anyone to a tenant except
 * its creator, and there is no joining by name or slug.
 *
 * The tenant picked on this device lives in a cookie, like the active project
 * (#426). It is only a hint: lib/tenant-context.ts checks it against the
 * person's memberships on every request, so a stale or forged id falls back.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const ACTIVE_TENANT_COOKIE = "ziki_active_tenant";
export const ACTIVE_TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const TENANT_NAME_MIN = 2;
export const TENANT_NAME_MAX = 60;
export const TENANT_SLUG_MAX = 48;

/** Creating tenants is rare; this only stops a script from filling the table. */
export const CREATE_TENANT_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };

export const MEMBERSHIP_ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const MEMBERSHIP_ROLE_ORDER: Record<MembershipRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

/**
 * Pair memberships with the people they point at. A membership whose user
 * row is gone is skipped: joining it in one query makes Prisma throw
 * "Field user is required" and the whole members page (/org/members) fails.
 */
export function tenantMembersFrom<TUser extends { id: string; name: string | null }>(
  memberships: { role: MembershipRole; createdAt: Date; userId: string }[],
  users: TUser[],
): { role: MembershipRole; createdAt: Date; user: TUser }[] {
  const byId = new Map(users.map((user) => [user.id, user]));
  return memberships
    .flatMap((membership) => {
      const user = byId.get(membership.userId);
      if (!user) return [];
      return [{ role: membership.role, createdAt: membership.createdAt, user }];
    })
    .sort((a, b) => {
      const byRole = MEMBERSHIP_ROLE_ORDER[a.role] - MEMBERSHIP_ROLE_ORDER[b.role];
      if (byRole !== 0) return byRole;
      return (a.user.name ?? "").localeCompare(b.user.name ?? "");
    });
}

export type TenantChoice = {
  id: string;
  slug: string;
  name: string;
  /** Set when the tenant is archived and can't be opened (#573). */
  archivedAt: Date | null;
  /** The person's role in this tenant. */
  role: MembershipRole;
};

const tenantChoiceSelect = {
  role: true,
  tenant: { select: { id: true, slug: true, name: true, archivedAt: true } },
} as const;

/** Same row, for a database that has not added Tenant.archivedAt yet (#573). */
const tenantIdentitySelect = {
  role: true,
  tenant: { select: { id: true, slug: true, name: true } },
} as const;

function toChoice(membership: {
  role: MembershipRole;
  tenant: { id: string; slug: string; name: string; archivedAt: Date | null };
}): TenantChoice {
  return { ...membership.tenant, role: membership.role };
}

function choiceWithoutArchive(membership: {
  role: MembershipRole;
  tenant: { id: string; slug: string; name: string };
}): TenantChoice {
  return { ...membership.tenant, archivedAt: null, role: membership.role };
}

/**
 * True when Postgres is behind the migration that added Tenant.archivedAt.
 * A printed query that merely mentions the name does not count.
 */
function archivedAtMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  const metaColumn =
    error !== null &&
    typeof error === "object" &&
    "meta" in error &&
    typeof (error as { meta?: { column?: unknown } }).meta?.column === "string"
      ? (error as { meta: { column: string } }).meta.column
      : "";
  if (/(?:^|[\w."]*\.)?archivedAt$/i.test(metaColumn)) return true;
  return /column [`'"]?(?:[\w."]+\.)*archivedAt[`'"]?(?: of relation [`'"]?[\w.]+[`'"]?)? does not exist/i.test(
    message,
  );
}

// ---------------------------------------------------------------------------
// The tenant picked on this device
// ---------------------------------------------------------------------------

export async function readActiveTenantCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value || null;
  } catch (error) {
    // Let Next see its own signals (e.g. "this page is dynamic").
    unstable_rethrow(error);
    // Tests and scripts have no cookie jar: nothing is picked.
    return null;
  }
}

/** Remember the tenant on this device. Callers check the membership first. */
export async function setActiveTenantCookie(tenantId: string): Promise<void> {
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, appCookieOptions(ACTIVE_TENANT_COOKIE_MAX_AGE));
}

// ---------------------------------------------------------------------------
// The person's tenants, and where they land
// ---------------------------------------------------------------------------

/** Only the tenants the person belongs to, by name. Never anyone else's. */
export async function tenantsForUser(
  db: Db,
  userId: string,
  userRole?: AppRole | null,
): Promise<TenantChoice[]> {
  try {
    const memberships = await db.membership.findMany({
      where: { userId },
      select: tenantChoiceSelect,
      orderBy: { tenant: { name: "asc" } },
    });
    const choices = memberships.map(toChoice);
    if (isSuperAdmin(userRole)) {
      return choices.map((c) => ({ ...c, role: "owner" as const }));
    }
    return choices;
  } catch (error) {
    if (!archivedAtMissing(error)) {
      console.error("[tenants] tenantsForUser failed", error);
      return [];
    }
    console.error("[tenants] archivedAt is missing; listing tenants without it", error);
    try {
      const memberships = await db.membership.findMany({
        where: { userId },
        select: tenantIdentitySelect,
        orderBy: { tenant: { name: "asc" } },
      });
      const choices = memberships.map(choiceWithoutArchive);
      if (isSuperAdmin(userRole)) {
        return choices.map((c) => ({ ...c, role: "owner" as const }));
      }
      return choices;
    } catch (retryError) {
      console.error("[tenants] tenantsForUser failed", retryError);
      return [];
    }
  }
}

/**
 * Where the home page sends a signed-in person:
 *
 * - one membership: straight into it, never the picker;
 * - several, and one of them picked on this device: into that one;
 * - several and none picked, or none at all: the picker, where they can
 *   choose, create a tenant, or accept an invite.
 */
export function landingPath(
  memberTenantIds: ReadonlyArray<string>,
  pickedTenantId: string | null,
): "/home" | "/tenants" {
  if (memberTenantIds.length === 1) return "/home";
  if (pickedTenantId && memberTenantIds.includes(pickedTenantId)) return "/home";
  return "/tenants";
}

export async function homePathFor(db: Db, userId: string): Promise<"/home" | "/tenants"> {
  try {
    const memberships = await db.membership.findMany({
      where: { userId },
      select: { tenantId: true, tenant: { select: { archivedAt: true } } },
    });
    return landingPath(
      memberships.filter((m) => !m.tenant.archivedAt).map((m) => m.tenantId),
      await readActiveTenantCookie(),
    );
  } catch (error) {
    console.error("[tenants] homePathFor failed", error);
    return "/home";
  }
}

/** A tenant the person belongs to, by id. Null for any other id. */
export async function memberTenantById(
  db: Db,
  userId: string,
  tenantId: string,
): Promise<TenantChoice | null> {
  if (!tenantId) return null;
  try {
    const membership = await db.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: tenantChoiceSelect,
    });
    return membership ? toChoice(membership) : null;
  } catch (error) {
    if (!archivedAtMissing(error)) {
      console.error("[tenants] memberTenantById failed", error);
      return null;
    }
    console.error("[tenants] archivedAt is missing; loading the tenant without it", error);
    try {
      const membership = await db.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: tenantIdentitySelect,
      });
      return membership ? choiceWithoutArchive(membership) : null;
    } catch (retryError) {
      console.error("[tenants] memberTenantById failed", retryError);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Creating a tenant
// ---------------------------------------------------------------------------

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const hasControlChars = (value: string) => /[\u0000-\u001f\u007f]/.test(value);

/** Names are shown in the header and the picker: short, readable, one line. */
function nameRules(label: string) {
  return z
    .string()
    .refine(
      (value) => value.length >= TENANT_NAME_MIN,
      `${label} must be at least ${TENANT_NAME_MIN} characters.`,
    )
    .refine(
      (value) => value.length <= TENANT_NAME_MAX,
      `${label} must be ${TENANT_NAME_MAX} characters or fewer.`,
    )
    .refine((value) => !hasControlChars(value), `${label} can't contain control characters.`)
    // #537: a name is plain text. Angle brackets only ever mean markup here.
    .refine((value) => !/[<>]/.test(value), `${label} can't contain < or >.`);
}

export const tenantNameSchema = z
  .string()
  .transform(collapse)
  .pipe(nameRules("Workspace name"));

export const createTenantSchema = z.object({
  name: tenantNameSchema,
});

/** Slugs kept back because they read as route names, such as /tenants/invite. */
const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set(["invite", "new"]);

/**
 * A URL-safe slug from a display name, by the same rules as project slugs
 * (#426): accents dropped, lower case, runs of anything else become "-".
 */
export function slugFromName(name: string, fallback: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TENANT_SLUG_MAX)
    .replace(/-+$/g, "");
  return slug || fallback;
}

const SUFFIX_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function randomSuffix(): string {
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  return suffix;
}

/**
 * The slug to try on each attempt: the name's own slug first, then that slug
 * with a random tail. Random rather than "-2", "-3", ..., so the slug a
 * creator gets says nothing about how many tenants share their name.
 */
export function tenantSlugCandidate(
  base: string,
  attempt: number,
  suffix: () => string = randomSuffix,
): string {
  // An organisation's slug starts its addresses (`/<org>/<project>`), so never a top-level route's name.
  if (attempt === 0 && !RESERVED_TENANT_SLUGS.has(base) && !isReservedProjectSlug(base)) return base;
  const tail = `-${suffix()}`;
  return `${base.slice(0, TENANT_SLUG_MAX - tail.length).replace(/-+$/g, "")}${tail}`;
}

const SLUG_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export type CreateTenantResult =
  | {
      ok: true;
      tenant: { id: string; slug: string; name: string };
    }
  | {
      ok: false;
      error: string;
      field?: "name";
      /** #537: set when the creator already belongs to a tenant with this name. */
      duplicateName?: string;
    };

/**
 * Creates a tenant with the creator as its owner. It starts with no
 * projects: the owner creates them from the organisation's Projects page
 * (`/<org>`). Projects have no owner of their own: the tenant's owner owns
 * every project in it. One nested create, so a tenant never exists without
 * its owner.
 */
export async function createTenant(
  db: Db,
  creator: { id: string },
  input: { name?: unknown; confirmDuplicate?: unknown },
  suffix: () => string = randomSuffix,
): Promise<CreateTenantResult> {
  const parsed = createTenantSchema.safeParse({
    name: typeof input.name === "string" ? input.name : "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Check the organization's name.",
      field: "name",
    };
  }

  const { name } = parsed.data;
  const base = slugFromName(name, "tenant");

  // #537: two tenants you're in with the same name look identical. Ask first;
  // sending the same name back as `confirmDuplicate` creates it anyway.
  const confirmed = typeof input.confirmDuplicate === "string" && collapse(input.confirmDuplicate) === name;
  if (!confirmed) {
    const same = await db.membership.findFirst({
      where: { userId: creator.id, tenant: { name: { equals: name, mode: "insensitive" } } },
      select: { tenant: { select: { name: true, slug: true } } },
    });
    if (same) {
      return {
        ok: false,
        field: "name",
        duplicateName: name,
        error: `You're already in an organization called "${same.tenant.name}" (${same.tenant.slug}). Choose another name, or select Create anyway to have both.`,
      };
    }
  }

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = tenantSlugCandidate(base, attempt, suffix);
    try {
      const tenant = await db.tenant.create({
        data: {
          slug,
          name,
          memberships: { create: { userId: creator.id, role: "owner" } },
        },
        select: { id: true, slug: true, name: true },
      });
      await awardSignupBonus(db, creator.id, tenant.id);
      return { ok: true, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
    } catch (error) {
      // Only the slug is unique on a brand-new tenant: try another one.
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  return { ok: false, error: "Couldn't create that organization. Try a different name.", field: "name" };
}

// ---------------------------------------------------------------------------
// Renaming, archiving and deleting a tenant (#573)
// ---------------------------------------------------------------------------

export type TenantLifecycleResult =
  | { ok: true; tenant: TenantChoice }
  | { ok: false; error: string };

/** The tenant, only when this person owns it. */
async function ownerTenant(
  db: Db,
  userId: string,
  tenantId: string,
): Promise<TenantChoice | null> {
  if (!tenantId) return null;
  const membership = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: tenantChoiceSelect,
  });
  if (!membership || membership.role !== "owner") return null;
  return toChoice(membership);
}

/**
 * Rename a tenant without changing its slug: links and project URLs keep
 * working. Only an owner can rename, and archived tenants are read-only.
 */
export async function renameTenant(
  db: Db,
  userId: string,
  tenantId: string,
  name: unknown,
): Promise<TenantLifecycleResult> {
  const parsed = tenantNameSchema.safeParse(typeof name === "string" ? name : "");
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the organization's name." };
  }

  const tenant = await ownerTenant(db, userId, tenantId);
  if (!tenant) return { ok: false, error: "Only the organization's owner can rename it." };
  if (tenant.archivedAt) return { ok: false, error: "Restore this organization before renaming it." };

  await db.tenant.update({ where: { id: tenant.id }, data: { name: parsed.data } });
  return { ok: true, tenant: { ...tenant, name: parsed.data } };
}

/**
 * Archive or restore a tenant. Archiving hides it from the switcher, stops it
 * being auto-selected, and makes its settings read-only. Zedu is the default
 * workspace and is never archived.
 */
export async function setTenantArchived(
  db: Db,
  userId: string,
  tenantId: string,
  archived: boolean,
): Promise<TenantLifecycleResult> {
  const tenant = await ownerTenant(db, userId, tenantId);
  if (!tenant) return { ok: false, error: "Only the organization's owner can archive it." };
  if (archived && tenant.slug === ZEDU_SLUG) {
    return { ok: false, error: "Zedu is the default workspace and can't be archived." };
  }
  if (Boolean(tenant.archivedAt) === archived) return { ok: true, tenant };

  const archivedAt = archived ? new Date() : null;
  await db.tenant.update({ where: { id: tenant.id }, data: { archivedAt } });
  return { ok: true, tenant: { ...tenant, archivedAt } };
}

/**
 * Permanently delete an empty tenant. "Empty" means no issues, no agents and
 * no members besides the owner. Anything else must be archived instead.
 */
export async function deleteTenant(
  db: Db,
  userId: string,
  tenantId: string,
  confirmName: unknown,
): Promise<TenantLifecycleResult> {
  const tenant = await ownerTenant(db, userId, tenantId);
  if (!tenant) return { ok: false, error: "Only the organization's owner can delete it." };
  if (tenant.slug === ZEDU_SLUG) {
    return { ok: false, error: "Zedu is the default workspace and can't be deleted." };
  }

  const counts = await db.tenant.findUnique({
    where: { id: tenant.id },
    select: { _count: { select: { bugs: true, ideas: true, agents: true, memberships: true } } },
  });
  if (!counts) return { ok: false, error: "That organization no longer exists." };

  const { bugs, ideas, agents, memberships } = counts._count;
  if (bugs > 0 || ideas > 0 || agents > 0 || memberships > 1) {
    return {
      ok: false,
      error: "This organization still has issues, ideas, agents or other members. Archive it instead.",
    };
  }

  const typed = typeof confirmName === "string" ? confirmName.trim() : "";
  if (typed !== tenant.name) {
    return { ok: false, error: "Type the organization's name exactly to confirm." };
  }

  try {
    await db.tenant.delete({ where: { id: tenant.id } });
  } catch (error) {
    console.error("[tenants] deleteTenant failed", error);
    return { ok: false, error: "Couldn't delete this organization. Archive it instead." };
  }
  return { ok: true, tenant };
}

// ---------------------------------------------------------------------------
// Zedu's first owner
// ---------------------------------------------------------------------------

/**
 * Ensure a user has an owner membership in the primary Zedu tenant (#536).
 * Any super admin automatically gets owner privileges.
 */
export async function ensureZeduOwnerMembership(
  userId: string,
  db: Db,
): Promise<void> {
  const tenant = await db.tenant.upsert({
    where: { slug: ZEDU_SLUG },
    update: {},
    create: { slug: ZEDU_SLUG, name: "Ziki" },
  });

  await db.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId } },
    update: { role: "owner" },
    create: { tenantId: tenant.id, userId, role: "owner" },
  });
}

/**
 * Everyone moved into Zedu by the migration is a member, never an owner
 * (#423), so nobody could invite anyone. The site's super admin picks the
 * first owner from Zedu's existing members. This never adds anyone to Zedu,
 * and once Zedu has an owner the super admin has no say here.
 */
export async function zeduNeedsOwner(db: Db): Promise<boolean> {
  const zedu = await db.tenant.findUnique({ where: { slug: ZEDU_SLUG }, select: { id: true } });
  if (!zedu) return false;
  const owners = await db.membership.count({ where: { tenantId: zedu.id, role: "owner" } });
  return owners === 0;
}

const memberEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter the member's email address."));

export type PromoteOwnerResult =
  | { ok: true; name: string }
  | { ok: false; error: string; field?: "email" };

export async function promoteFirstZeduOwner(
  db: Db,
  actor: { role?: AppRole | null },
  email: unknown,
): Promise<PromoteOwnerResult> {
  if (!isSuperAdmin(actor.role)) {
    return { ok: false, error: "Only the site's super admin can choose Zedu's first owner." };
  }
  const parsed = memberEmailSchema.safeParse(typeof email === "string" ? email : "");
  if (!parsed.success) {
    return { ok: false, error: "Enter the member's email address.", field: "email" };
  }

  const zedu = await db.tenant.findUnique({ where: { slug: ZEDU_SLUG }, select: { id: true } });
  if (!zedu) return { ok: false, error: "There's no Zedu organization yet. Run the database migrations." };

  const owners = await db.membership.count({ where: { tenantId: zedu.id, role: "owner" } });
  if (owners > 0) return { ok: false, error: "Zedu already has an owner." };

  const membership = await db.membership.findFirst({
    where: { tenantId: zedu.id, user: { email: { equals: parsed.data, mode: "insensitive" } } },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!membership) {
    return { ok: false, error: "Nobody in Zedu has that email. Only an existing member can be made owner.", field: "email" };
  }

  await db.membership.update({ where: { id: membership.id }, data: { role: "owner" } });
  return { ok: true, name: membership.user.name };
}
