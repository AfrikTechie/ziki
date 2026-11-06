import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * The Send 10 emails task (#earn-outreach). Each business an earner emails gets its own link,
 * ziki.dev/r/<code>, so the earner can see who opened it and follow up. The earner sends every email
 * from their own address; Ziki never sends them. The businesses come from the earner's Research task
 * answer (one per line: name, where, email or website), and the earner can add more by hand.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** How many businesses the task asks for. */
export const OUTREACH_TARGET = 10;

const EMAIL = /[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}/i;
const WEBSITE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?/i;

/** One business from a line of the Research answer: its name, and an email or website when the line has one. */
export function parseResearchLine(line: string): { name: string; contact: string | null } | null {
  const text = line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim();
  if (!text) return null;
  const email = text.match(EMAIL)?.[0] ?? null;
  const website = email ? null : text.match(WEBSITE)?.[0] ?? null;
  const contact = email ?? website;
  const name = (text.split(/[,–—|]| - /)[0] ?? text).replace(contact ?? "", "").trim() || text;
  return { name: name.slice(0, 120), contact: contact ? contact.slice(0, 200) : null };
}

/** The businesses in a Research answer, at most the task's target, without repeats. */
export function parseResearch(proof: string | null | undefined): { name: string; contact: string | null }[] {
  const seen = new Set<string>();
  const out: { name: string; contact: string | null }[] = [];
  for (const line of (proof ?? "").split(/\r?\n/)) {
    const business = parseResearchLine(line);
    if (!business) continue;
    const key = business.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(business);
    if (out.length >= OUTREACH_TARGET) break;
  }
  return out;
}

/** A short, unguessable link id. */
export function newCode(): string {
  return crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 7).toLowerCase() || crypto.randomUUID().slice(0, 7);
}

/** The earner's businesses, oldest first. */
export async function contactsFor(db: Db, userId: string) {
  return db.earnContact.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
}

/**
 * The earner's businesses, filled in from their Research answer the first time they open the email task.
 * Does nothing once they have any, so it never adds the same list twice.
 */
export async function ensureContacts(db: Db, userId: string) {
  const existing = await contactsFor(db, userId);
  if (existing.length > 0) return existing;
  const research = await db.earnTaskProgress.findUnique({ where: { userId_taskKey: { userId, taskKey: "research" } }, select: { proof: true } });
  const businesses = parseResearch(research?.proof);
  for (const business of businesses) {
    await db.earnContact.create({ data: { userId, name: business.name, contact: business.contact, code: newCode() } });
  }
  return contactsFor(db, userId);
}

/** Adds one business by hand, up to the target. */
export async function addContact(db: Db, userId: string, input: { name: string; contact?: string | null }) {
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Add the business's name." };
  const count = await db.earnContact.count({ where: { userId } });
  if (count >= OUTREACH_TARGET) return { ok: false as const, error: `You already have ${OUTREACH_TARGET} businesses.` };
  await db.earnContact.create({ data: { userId, name: name.slice(0, 120), contact: input.contact?.trim().slice(0, 200) || null, code: newCode() } });
  return { ok: true as const };
}

/** Ticks one business sent, or unticks it. Only the earner's own. */
export async function setSent(db: Db, userId: string, id: string, sent: boolean) {
  const { count } = await db.earnContact.updateMany({ where: { id, userId }, data: { sentAt: sent ? new Date() : null } });
  return count === 1;
}

/** Someone opened a business's link: count it. Returns whether the link exists. */
export async function recordOpen(db: Db, code: string) {
  const now = new Date();
  const contact = await db.earnContact.findUnique({ where: { code }, select: { id: true, openedAt: true } });
  if (!contact) return false;
  await db.earnContact.update({ where: { id: contact.id }, data: { opens: { increment: 1 }, lastOpenAt: now, ...(contact.openedAt ? {} : { openedAt: now }) } });
  return true;
}

/** The proof the task sends in: who was emailed, and who opened their link so far. */
export function outreachProof(contacts: { name: string; contact: string | null; sentAt: Date | null; opens: number }[]): string {
  return contacts
    .filter((contact) => contact.sentAt)
    .map((contact) => `${contact.name}${contact.contact ? `, ${contact.contact}` : ""}${contact.opens > 0 ? " (opened the link)" : ""}`)
    .join("\n");
}

/** The email the earner's agent would write, as a starting point the earner copies: short, friendly, with the business's own link. */
export function emailDraft(businessName: string, link: string, senderName: string): string {
  const from = senderName.trim().split(/\s+/)[0] || "there";
  return `Subject: A simple way to get more orders online\n\nHi ${businessName} team,\n\nI came across your business and thought Ziki could help you. It's a place where AI agents build and market a simple product for you, like an online ordering page, so customers can find you without the hassle.\n\nHave a look here: ${link}\n\nHappy to answer any questions.\n\n${from}`;
}

/** A short follow-up for a business that hasn't opened its link. */
export function followUpDraft(businessName: string, link: string, senderName: string): string {
  const from = senderName.trim().split(/\s+/)[0] || "there";
  return `Hi ${businessName} team, just checking you saw my note about Ziki. It could get you a simple ordering page without the hassle. Here's the link again: ${link}\n\n${from}`;
}

/** Emailed more than three days ago and nobody has opened the link: time to follow up. */
export function isQuiet(contact: { sentAt: Date | null; openedAt: Date | null }): boolean {
  return Boolean(contact.sentAt && !contact.openedAt && Date.now() - contact.sentAt.getTime() > 3 * 24 * 60 * 60 * 1000);
}

/** The browser note a business's link leaves, so a sign-up that follows can be traced back to it. */
export const EARN_REF_COOKIE = "earn-ref";
/** How long the note lasts: a business that signs up within 30 days of opening the link counts. */
export const EARN_REF_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Traces a new account back to the business link it came from (#earn-outreach): a signed-in person whose
 * browser carries a link's note, whose account was made after that link was first opened, and who isn't the
 * earner themselves, is that business signing up. Each account counts for one business, once. Then, once that
 * account owns an organisation of its own (not Ziki Earn), the business has started a project. Safe to call on every
 * page: it only writes the first time each thing happens.
 */
export async function syncReferral(db: Db, userId: string, code: string | null, earnOrganisationId: string | null) {
  if (code) {
    const [contact, user] = await Promise.all([
      db.earnContact.findUnique({ where: { code }, select: { id: true, userId: true, signedUpUserId: true, openedAt: true, createdAt: true } }),
      db.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    ]);
    const opened = contact?.openedAt ?? contact?.createdAt;
    if (contact && user && !contact.signedUpUserId && contact.userId !== userId && opened && user.createdAt >= opened) {
      const already = await db.earnContact.findUnique({ where: { signedUpUserId: userId }, select: { id: true } });
      if (!already) await db.earnContact.update({ where: { id: contact.id }, data: { signedUpUserId: userId, signedUpAt: new Date() } });
    }
  }
  const signedUp = await db.earnContact.findUnique({ where: { signedUpUserId: userId }, select: { id: true, startedAt: true } });
  if (signedUp && !signedUp.startedAt) {
    const owned = await db.membership.count({ where: { userId, role: "owner", ...(earnOrganisationId ? { organisationId: { not: earnOrganisationId } } : {}) } });
    if (owned > 0) await db.earnContact.update({ where: { id: signedUp.id }, data: { startedAt: new Date() } });
  }
}
