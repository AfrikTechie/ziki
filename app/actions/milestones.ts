"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { milestoneInputSchema, parseDueDate } from "@/lib/milestones";
import { milestoneScopeFor } from "@/lib/milestone-stats";

export type MilestoneActionResult = { ok?: true; error?: string; cleared?: number };

const NOT_FOUND = "That milestone no longer exists.";

function isCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === code;
}

function revalidateMilestones() {
  revalidatePath("/[org]/[project]/org", "layout");
  revalidatePath("/milestones");
  revalidatePath("/[org]/[project]", "layout");
  revalidatePath("/bugs");
}

function readInput(formData: FormData) {
  const due = parseDueDate(formData.get("dueDate")?.toString());
  if (due === "invalid") return { error: "Pick a valid due date, or leave it empty." } as const;
  const rawDescription = formData.get("description")?.toString() ?? "";
  const parsed = milestoneInputSchema.safeParse({
    title: formData.get("title")?.toString() ?? "",
    description: rawDescription.trim() ? rawDescription : null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  return { data: { ...parsed.data, dueDate: due } } as const;
}

async function titleTaken(tenantId: string, title: string, exceptId?: string) {
  return prisma.milestone.findFirst({
    where: {
      tenantId,
      title: { equals: title, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { title: true },
  });
}

export async function createMilestoneAction(formData: FormData): Promise<MilestoneActionResult> {
  const scope = await milestoneScopeFor(await requireUser());
  if (!scope.ok) return { error: scope.error };

  const input = readInput(formData);
  if ("error" in input) return { error: input.error };
  const taken = await titleTaken(scope.tenantId, input.data.title);
  if (taken) return { error: `A milestone named "${taken.title}" already exists.` };
  try {
    await prisma.milestone.create({
      data: {
        ...input.data,
        tenantId: scope.tenantId,
      },
    });
  } catch (err) {
    if (isCode(err, "P2002")) return { error: `A milestone named "${input.data.title}" already exists.` };
    throw err;
  }
  revalidateMilestones();
  return { ok: true };
}

export async function updateMilestoneAction(id: string, formData: FormData): Promise<MilestoneActionResult> {
  const scope = await milestoneScopeFor(await requireUser());
  if (!scope.ok) return { error: scope.error };

  const existing = await prisma.milestone.findFirst({
    where: { id, tenantId: scope.tenantId },
  });
  if (!existing) return { error: NOT_FOUND };

  const input = readInput(formData);
  if ("error" in input) return { error: input.error };
  const taken = await titleTaken(scope.tenantId, input.data.title, id);
  if (taken) return { error: `Another milestone is named "${taken.title}".` };
  try {
    await prisma.milestone.update({ where: { id }, data: input.data });
  } catch (err) {
    if (isCode(err, "P2025")) return { error: NOT_FOUND };
    if (isCode(err, "P2002")) return { error: `Another milestone is named "${input.data.title}".` };
    throw err;
  }
  revalidateMilestones();
  return { ok: true };
}

/** Closing leaves every issue where it is; it only stops new ones joining. */
export async function setMilestoneClosedAction(id: string, closed: boolean): Promise<MilestoneActionResult> {
  const scope = await milestoneScopeFor(await requireUser());
  if (!scope.ok) return { error: scope.error };

  const existing = await prisma.milestone.findFirst({
    where: { id, tenantId: scope.tenantId },
  });
  if (!existing) return { error: NOT_FOUND };

  try {
    await prisma.milestone.update({
      where: { id },
      data: { isClosed: closed, closedAt: closed ? new Date() : null },
    });
  } catch (err) {
    if (isCode(err, "P2025")) return { error: NOT_FOUND };
    throw err;
  }
  revalidateMilestones();
  return { ok: true };
}

/** Record removals atomically with the database's non-destructive SET NULL. */
export async function deleteMilestoneAction(id: string): Promise<MilestoneActionResult> {
  const user = await requireUser();
  const scope = await milestoneScopeFor(user);
  if (!scope.ok) return { error: scope.error };

  let cleared: number;
  try {
    cleared = await prisma.$transaction(async (tx) => {
      const milestone = await tx.milestone.findFirst({
        where: { id, tenantId: scope.tenantId },
        select: { title: true, bugs: { select: { id: true } } },
      });
      if (!milestone) {
        throw Object.assign(new Error(NOT_FOUND), { code: "P2025" });
      }
      if (milestone.bugs.length) {
        await tx.bugActivity.createMany({
          data: milestone.bugs.map((bug) => ({
            bugId: bug.id,
            actorId: user.id,
            type: "milestone_changed",
            summary: `removed this from milestone "${milestone.title}"`,
            metadata: { field: "milestone", from: milestone.title, to: null },
          })),
        });
      }
      await tx.milestone.delete({ where: { id } });
      return milestone.bugs.length;
    }, { isolationLevel: "Serializable" });
  } catch (err) {
    if (isCode(err, "P2025")) return { error: NOT_FOUND };
    throw err;
  }
  revalidateMilestones();
  return { ok: true, cleared };
}
