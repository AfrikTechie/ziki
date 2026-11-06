"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { startTask, submitTask } from "@/lib/earn/progress";
import { OUTREACH_TARGET, addContact, contactsFor, outreachProof, setSent } from "@/lib/earn/outreach";
import { requireEarnAgent } from "@/lib/earn/state";

export type EarnActionResult = { error?: string; message?: string };

/** Starts one task by hand (its number comes with the form); the others stay open. */
export async function startEarnTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  // A task cannot be started until the person's agent is connected.
  await requireEarnAgent(user.id);
  await startTask(prisma, user.id, Number(formData.get("n")));
  revalidatePath("/earn", "layout");
}

/** Sends the earner's own task in for checking, with what they did. */
export async function submitEarnTaskAction(_prev: EarnActionResult, formData: FormData): Promise<EarnActionResult> {
  const user = await requireUser();
  const n = Number(formData.get("n"));
  const proof = typeof formData.get("proof") === "string" ? (formData.get("proof") as string) : "";
  try {
    const result = await submitTask(prisma, user.id, n, proof);
    if (!result.ok) return { error: result.error };
    revalidatePath("/earn", "layout");
    return { message: "Sent. Ziki will check it." };
  } catch (error) {
    console.error("[earn] submit failed", error);
    return { error: "Could not send it. Try again." };
  }
}

/** Ticks or unticks one business as emailed (#earn-outreach). */
export async function setContactSentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await requireEarnAgent(user.id);
  await setSent(prisma, user.id, String(formData.get("id") ?? ""), formData.get("sent") === "1");
  revalidatePath("/earn", "layout");
}

/** Adds one business by hand to the email task (#earn-outreach). */
export async function addContactAction(_prev: EarnActionResult, formData: FormData): Promise<EarnActionResult> {
  const user = await requireUser();
  await requireEarnAgent(user.id);
  const result = await addContact(prisma, user.id, { name: String(formData.get("name") ?? ""), contact: String(formData.get("contact") ?? "") });
  if (!result.ok) return { error: result.error };
  revalidatePath("/earn", "layout");
  return { message: "Added." };
}

/** Sends the email task in once every business is ticked sent: the proof is who was emailed (#earn-outreach). */
export async function submitOutreachAction(_prev: EarnActionResult): Promise<EarnActionResult> {
  const user = await requireUser();
  await requireEarnAgent(user.id);
  const contacts = await contactsFor(prisma, user.id);
  const sent = contacts.filter((contact) => contact.sentAt).length;
  if (sent < OUTREACH_TARGET) return { error: `Tick all ${OUTREACH_TARGET} once you have emailed them. ${OUTREACH_TARGET - sent} to go.` };
  try {
    const result = await submitTask(prisma, user.id, 3, outreachProof(contacts));
    if (!result.ok) return { error: result.error };
    revalidatePath("/earn", "layout");
    return { message: "Sent. Ziki will check it." };
  } catch (error) {
    console.error("[earn] outreach submit failed", error);
    return { error: "Could not send it. Try again." };
  }
}
