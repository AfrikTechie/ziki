import { PRODUCT_TRACK } from "@/lib/marketing/track";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { DEFAULT_BUG_TEMPLATE, DEFAULT_TEMPLATE_TYPE, TEMPLATE_MAX } from "@/lib/issue-templates";
import type { AppRole } from "@/lib/roles";
import { isAdmin } from "@/lib/roles";
import { isTenantAdminRole } from "@/lib/agents/membership";
import { currentTenantIdFor } from "@/lib/tenant-context";

export const DEFAULT_ISSUE_TYPES = [
  { name: "Marketing", description: "Marketing and promotion related tasks" },
  { name: "Design", description: "UI/UX and visual design tasks" },
  { name: "Fix", description: "Issue fixes and defect resolutions" },
  { name: "Feat", description: "New features and enhancements" },
] as const;

export const issueTypeInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Type name must be at least 2 characters")
    .max(50, "Type name must be at most 50 characters"),
  description: z.string().trim().max(300).optional().nullable(),
  template: z
    .string()
    .max(TEMPLATE_MAX, `Keep the template to ${TEMPLATE_MAX} characters or fewer`)
    .optional()
    .nullable(),
  isActive: z.boolean().optional().default(true),
});

export type IssueTypeInput = z.infer<typeof issueTypeInputSchema>;

export {
  issueTypeBadgeClass,
  getIssueTypeBadgeClass,
} from "./issue-type-styles";

/**
 * Checks whether an issue type can be safely deleted.
 * Types in use cannot be deleted without handling existing issues.
 */
export function canDeleteIssueType(bugCount: number): {
  allowed: boolean;
  reason?: string;
} {
  if (bugCount > 0) {
    return {
      allowed: false,
      reason: `Cannot delete type because it is in use by ${bugCount} issue${bugCount === 1 ? "" : "s"}. Deactivate it instead.`,
    };
  }
  return { allowed: true };
}

export type IssueTypeScope =
  | { ok: true; tenantId: string; tenantName: string; userId: string }
  | { ok: false; forbidden: boolean; error: string };

/**
 * The organization whose issue types this person may change.
 * Site admins and the organization's owners and admins may.
 */
export async function issueTypeScopeFor(user: {
  id: string;
  role?: AppRole | null;
}): Promise<IssueTypeScope> {
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) {
    return {
      ok: false,
      forbidden: false,
      error: "Open an organization before managing issue types.",
    };
  }

  const [tenant, membership] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
    prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      select: { role: true },
    }),
  ]);
  if (!tenant) {
    return {
      ok: false,
      forbidden: false,
      error: "The selected organization no longer exists.",
    };
  }
  const allowed = isAdmin(user.role) || isTenantAdminRole(membership?.role, user.role);
  if (!allowed) {
    return {
      ok: false,
      forbidden: true,
      error: "Only organization admins may manage issue types.",
    };
  }
  return { ok: true, tenantId, tenantName: tenant.name, userId: user.id };
}

/**
 * Ensures default issue types (Marketing, Design, Fix, Feat) exist for a tenant only when empty.
 */
export async function ensureDefaultIssueTypes(tenantId: string): Promise<void> {
  const count = await prisma.issueType.count({ where: { tenantId, ...PRODUCT_TRACK } });
  if (count > 0) return;

  for (const item of DEFAULT_ISSUE_TYPES) {
    await prisma.issueType.upsert({
      where: { tenantId_name: { tenantId, name: item.name } },
      update: {},
      create: {
        tenantId,
        name: item.name,
        description: item.description,
        template: item.name === DEFAULT_TEMPLATE_TYPE ? DEFAULT_BUG_TEMPLATE : null,
        isActive: true,
      },
    });
  }
}
