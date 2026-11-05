"use server";

import { revalidatePath } from "next/cache";
import type { MembershipRole } from "@prisma/client";
import { requireUser } from "@/lib/auth-helpers";
import {
  changeMembershipRole,
  leaveMembership,
  removeMembership,
} from "@/lib/membership-admin";
import { prisma } from "@/lib/prisma";

export type MembershipActionResult = { error?: string; ok?: boolean };

/** Members are listed in /org; a person's own organizations in /tenants. */
function revalidateTenant() {
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/tenants");
}

function cleanId(value: string): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 ? id : null;
}

/** Promote or demote someone inside one organization. Does not change their site-wide role. */
export async function setMemberRoleAction(
  tenantId: string,
  userId: string,
  nextRole: MembershipRole,
): Promise<MembershipActionResult> {
  const actor = await requireUser();
  const tenant = cleanId(tenantId);
  const target = cleanId(userId);
  if (!tenant || !target) return { error: "That person isn't in this organization." };
  if (nextRole !== "admin" && nextRole !== "member") {
    return { error: "Only an owner of this organization can change roles." };
  }

  const result = await changeMembershipRole(prisma, actor, {
    tenantId: tenant,
    targetUserId: target,
    nextRole,
  });
  if (!result.ok) return { error: result.error };
  revalidateTenant();
  return { ok: true };
}

/** Remove someone from one organization. They keep their account. */
export async function removeMemberAction(
  tenantId: string,
  userId: string,
): Promise<MembershipActionResult> {
  const actor = await requireUser();
  const tenant = cleanId(tenantId);
  const target = cleanId(userId);
  if (!tenant || !target) return { error: "That person isn't in this organization." };

  const result = await removeMembership(prisma, actor, { tenantId: tenant, targetUserId: target });
  if (!result.ok) return { error: result.error };
  revalidateTenant();
  return { ok: true };
}

/** Leave an organization. The last owner has to choose someone else first. */
export async function leaveTenantAction(tenantId: string): Promise<MembershipActionResult> {
  const actor = await requireUser();
  const tenant = cleanId(tenantId);
  if (!tenant) return { error: "That person isn't in this organization." };

  const result = await leaveMembership(prisma, actor, tenant);
  if (!result.ok) return { error: result.error };
  revalidateTenant();
  return { ok: true };
}
