"use server";

import { revalidatePath } from "next/cache";
import { expireTag, TAGS } from "@/lib/cache-tags";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { canDeleteIssueType, issueTypeInputSchema, issueTypeScopeFor } from "@/lib/issue-types";
import { typeChangedSummary } from "@/lib/activity-log";
import { normalizeTemplate } from "@/lib/issue-templates";

export type IssueTypeActionResult = { error?: string; ok?: boolean };

const TYPE_NOT_FOUND = "Type not found";

/** Prisma P2025: the row was deleted (e.g. by another admin) before we wrote to it. */
function isRecordNotFound(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && err.code === "P2025"
  );
}

export async function createIssueTypeAction(
  formData: FormData,
): Promise<IssueTypeActionResult> {
  const scope = await issueTypeScopeFor(await requireUser());
  if (!scope.ok) return { error: scope.error };

  const rawName = formData.get("name")?.toString() ?? "";
  const rawDesc = formData.get("description")?.toString() ?? "";
  // Absent (an older client) leaves the template as it was on update.
  const rawTemplate = formData.get("template");
  const rawActive = formData.get("isActive");
  const isActive = rawActive !== null ? rawActive === "true" || rawActive === "on" : true;

  const parsed = issueTypeInputSchema.safeParse({
    name: rawName,
    description: rawDesc ? rawDesc : null,
    template: typeof rawTemplate === "string" ? rawTemplate : null,
    isActive,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const normalizedName = parsed.data.name.trim();

  const existing = await prisma.issueType.findFirst({
    where: {
      tenantId: scope.tenantId,
      name: {
        equals: normalizedName,
        mode: "insensitive",
      },
    },
  });

  if (existing) {
    return { error: `A type named "${existing.name}" already exists.` };
  }

  try {
    await prisma.issueType.create({
      data: {
        tenantId: scope.tenantId,
        name: normalizedName,
        description: parsed.data.description,
        template: normalizeTemplate(parsed.data.template),
        isActive: parsed.data.isActive,
      },
    });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "P2002"
    ) {
      return { error: `A type named "${normalizedName}" already exists.` };
    }
    throw err;
  }

  expireTag(TAGS.issueTypes);
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath("/bugs/new");
  return { ok: true };
}

export async function updateIssueTypeAction(
  id: string,
  formData: FormData,
): Promise<IssueTypeActionResult> {
  const user = await requireUser();
  const scope = await issueTypeScopeFor(user);
  if (!scope.ok) return { error: scope.error };

  if (!id || typeof id !== "string") {
    return { error: "Invalid type ID" };
  }

  const rawName = formData.get("name")?.toString() ?? "";
  const rawDesc = formData.get("description")?.toString() ?? "";
  // Absent (an older client) leaves the template as it was on update.
  const rawTemplate = formData.get("template");
  const rawActive = formData.get("isActive");
  const isActive = rawActive !== null ? rawActive === "true" || rawActive === "on" : true;

  const parsed = issueTypeInputSchema.safeParse({
    name: rawName,
    description: rawDesc ? rawDesc : null,
    template: typeof rawTemplate === "string" ? rawTemplate : null,
    isActive,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const normalizedName = parsed.data.name.trim();

  const currentType = await prisma.issueType.findFirst({
    where: { id, tenantId: scope.tenantId },
  });

  if (!currentType) {
    return { error: TYPE_NOT_FOUND };
  }

  const existing = await prisma.issueType.findFirst({
    where: {
      tenantId: scope.tenantId,
      name: {
        equals: normalizedName,
        mode: "insensitive",
      },
      NOT: { id },
    },
  });

  if (existing) {
    return { error: `Another type named "${existing.name}" already exists.` };
  }

  let linkedBugIds: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.issueType.findFirst({
        where: { id, tenantId: scope.tenantId },
      });
      if (!current) {
        return;
      }

      await tx.issueType.update({
        where: { id },
        data: {
          name: normalizedName,
          description: parsed.data.description,
          ...(typeof rawTemplate === "string"
            ? { template: normalizeTemplate(parsed.data.template) }
            : {}),
          isActive: parsed.data.isActive,
        },
      });

      if (current.name !== normalizedName) {
        const linkedBugs = await tx.bug.findMany({
          where: { typeId: id, tenantId: scope.tenantId },
          select: { id: true },
        });

        if (linkedBugs.length > 0) {
          linkedBugIds = linkedBugs.map((b) => b.id);
          await tx.bugActivity.createMany({
            data: linkedBugs.map((b) => ({
              bugId: b.id,
              actorId: user.id,
              type: "type_changed",
              summary: typeChangedSummary(current.name, normalizedName),
              metadata: {
                field: "type",
                from: current.name,
                to: normalizedName,
              },
            })),
          });
        }
      }
    });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "P2002"
    ) {
      return { error: `Another type named "${normalizedName}" already exists.` };
    }
    if (isRecordNotFound(err)) {
      return { error: TYPE_NOT_FOUND };
    }
    throw err;
  }

  expireTag(TAGS.issueTypes);
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath("/bugs/new");
  revalidatePath("/bugs");
  for (const bugId of linkedBugIds) {
    revalidatePath(`/bugs/${bugId}`);
  }
  return { ok: true };
}

export async function toggleIssueTypeActiveAction(
  id: string,
): Promise<IssueTypeActionResult> {
  const scope = await issueTypeScopeFor(await requireUser());
  if (!scope.ok) return { error: scope.error };

  if (!id || typeof id !== "string") {
    return { error: "Invalid type ID" };
  }

  const existing = await prisma.issueType.findFirst({
    where: { id, tenantId: scope.tenantId },
    select: { isActive: true },
  });

  if (!existing) {
    return { error: "Type not found" };
  }

  await prisma.issueType.update({
    where: { id },
    data: { isActive: !existing.isActive },
  });

  expireTag(TAGS.issueTypes);
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath("/bugs/new");
  return { ok: true };
}

export async function deleteIssueTypeAction(
  id: string,
): Promise<IssueTypeActionResult> {
  const scope = await issueTypeScopeFor(await requireUser());
  if (!scope.ok) return { error: scope.error };

  if (!id || typeof id !== "string") {
    return { error: "Invalid type ID" };
  }

  const existing = await prisma.issueType.findFirst({
    where: { id, tenantId: scope.tenantId },
    select: { id: true },
  });

  if (!existing) {
    return { error: TYPE_NOT_FOUND };
  }

  const count = await prisma.bug.count({
    where: { typeId: id, tenantId: scope.tenantId },
  });

  const check = canDeleteIssueType(count);
  if (!check.allowed) {
    return { error: check.reason };
  }

  try {
    await prisma.issueType.delete({
      where: { id },
    });
  } catch (err: unknown) {
    if (isRecordNotFound(err)) {
      return { error: TYPE_NOT_FOUND };
    }
    throw err;
  }

  expireTag(TAGS.issueTypes);
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath("/bugs/new");
  return { ok: true };
}
