/**
 * A second fixture workspace, "Fresh Start": what an account looks like right
 * after signing up and creating its organization. One owner, one project, the
 * signup bonus, and nothing else: no issues,
 * ideas, agents, teammates or history.
 *
 * Sign in as fresh@fixtures.local with the Demo password (ziki-demo-password).
 * The account is in no other workspace, so it sees only this empty one.
 *
 * It mirrors createTenant() in lib/tenants.ts without importing it (the loader
 * runs outside the app). Like the Demo workspace it touches only its own rows
 * (id `fx-tenant-fresh`, slug `fresh`) and a rerun recreates it as new.
 */
import type { PrismaClient } from "@prisma/client";

export const FRESH_LOGIN_EMAIL = "fresh@fixtures.local";
const USER_ID = "fx-user-fresh";
const TENANT_ID = "fx-tenant-fresh";
const PROJECT_ID = "fx-project-fresh";
const SLUG = "fresh";
const NAME = "Fresh Start";
/** SIGNUP_BONUS_POINTS in lib/points/signup-bonus.ts. */
const SIGNUP_BONUS = 0.67;

export async function loadFreshWorkspace(db: PrismaClient, passwordHash: string): Promise<void> {
  const existing = await db.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (existing && existing.id !== TENANT_ID) throw new Error(`A "${SLUG}" workspace exists that the fixtures didn't make; not touching it.`);
  // Everything in the workspace cascades from it, the signup bonus included.
  if (existing) await db.tenant.delete({ where: { id: TENANT_ID } });

  const user = await db.user.upsert({
    where: { email: FRESH_LOGIN_EMAIL },
    update: { name: "Fresh Signup", passwordHash },
    create: { id: USER_ID, email: FRESH_LOGIN_EMAIL, name: "Fresh Signup", emailVerified: new Date(), emailNotifications: false, passwordHash },
    select: { id: true },
  });
  // A rerun gives the account a clean start: in no workspace but this one.
  await db.membership.deleteMany({ where: { userId: user.id } });
  await db.pointEntry.deleteMany({ where: { userId: user.id, sourceKey: `signup:${user.id}` } });

  await db.tenant.create({
    data: {
      id: TENANT_ID,
      slug: SLUG,
      name: NAME,
      memberships: { create: { userId: user.id, role: "owner" } },
      projects: { create: { id: PROJECT_ID, slug: SLUG, name: NAME } },
    },
  });
  await db.pointEntry.create({
    data: { tenantId: TENANT_ID, userId: user.id, bugId: null, role: "signup", points: SIGNUP_BONUS, sourceKey: `signup:${user.id}` },
  });
}
