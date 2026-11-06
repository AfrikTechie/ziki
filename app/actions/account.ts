"use server";

import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { deleteUserAccount, SoleOrganisationOwnerError } from "@/lib/user-offboarding";
import { signOut } from "@/auth";
import { ACTIVE_ROLE_COOKIE_NAME } from "@/lib/roles";

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/**
 * Self-service account deletion action (#571).
 *
 * Refused if the caller is the sole owner of any organisation.
 * When allowed: revokes all agents and keys, removes memberships,
 * anonymises authored issues and comments, cleans up assigned bugs,
 * deletes the user account, and signs out.
 */
export async function deleteAccountAction(): Promise<DeleteAccountResult> {
  const user = await requireUser();

  try {
    await deleteUserAccount(prisma, user.id);
  } catch (error) {
    if (error instanceof SoleOrganisationOwnerError) {
      return { ok: false, error: error.message };
    }
    const message =
      error instanceof Error ? error.message : "Failed to delete account.";
    return { ok: false, error: message };
  }

  try {
    const cookieStore = await cookies();
    cookieStore.delete(ACTIVE_ROLE_COOKIE_NAME);
    await signOut({ redirectTo: "/login?deleted=1" });
  } catch (error) {
    // Next.js uses redirect exceptions to navigate; let them bubble
    throw error;
  }

  return { ok: true };
}
