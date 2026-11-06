/**
 * Local scenario: three people in the Demo organisation with point histories to
 * try the profile's "Where the points came from" section (#points-sources)
 * against, from honest to farmed. Their ledger entries use the same sourceKey
 * formats as the real awards (lib/points/rules.ts), on real Demo issues.
 *
 *   pnpm db:scenario:points-farming
 *
 * - Nadia Normal: points from delivered work (solving, judging, confirming),
 *   with a few votes and idea opinions. Nothing should be flagged.
 * - Felix Farmer: hundreds of comment upvotes, nearly all from one account,
 *   a burst of awards within one hour, importance marks by the hundred, and
 *   opinions on his own ideas. Every signal should fire.
 * - Sam Spread: hundreds of comment upvotes from many different accounts, a
 *   few each. Only the "mostly small actions" signal fires.
 *
 * Additive only: it never resets or reseeds. Its rows have fixed ids
 * (`scn-pf-*`) and emails (`*@scenario.local`), and a rerun deletes and
 * recreates just this scenario's people, agents, ideas and ledger entries.
 * It refuses to run against anything but a local database. Run
 * `pnpm db:fixtures` first so the Demo organisation exists. Sign in as
 * demo@fixtures.local (an owner, so it sees everyone's breakdown); the script
 * prints the three profile addresses.
 */
import { PrismaClient } from "@prisma/client";

const ORGANISATION_ID = "fx-organisation";
const PROJECT_ID = "fx-project";
const P = "scn-pf";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to write a scenario to a non-local database (${host}).`);
  }
}

/** Deterministic pseudo-random numbers, so every run writes the same history. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

type Entry = {
  /** A fixed id when another entry refers to it (a correction names the entry it reverses). */
  id?: string;
  userId: string;
  agentId: string | null;
  role: "solver" | "reviewer" | "comment" | "vote" | "idea" | "signup" | "reporter";
  points: number;
  sourceKey: string;
  createdAt: Date;
  bugId?: string | null;
  ideaId?: string | null;
  correctedAt?: Date | null;
};

async function main() {
  assertLocalDatabase(process.env.DATABASE_URL);
  const db = new PrismaClient();
  const now = Date.now();
  const random = seeded(42);
  const ago = (ms: number) => new Date(now - ms);
  const withinDays = (days: number) => ago(Math.floor(random() * days * DAY));

  try {
    const organisation = await db.organisation.findUnique({ where: { id: ORGANISATION_ID }, select: { id: true } });
    if (!organisation) throw new Error("The Demo organisation isn't loaded. Run `pnpm db:fixtures` first.");
    const bugs = await db.bug.findMany({
      where: { organisationId: ORGANISATION_ID, isDeleted: false },
      orderBy: { number: "asc" },
      select: { id: true },
    });
    if (bugs.length < 50) throw new Error("The Demo organisation has too few issues; run `pnpm db:fixtures`.");
    const bugAt = (index: number) => bugs[index % bugs.length].id;

    // A rerun replaces only this scenario's rows.
    await db.pointEntry.deleteMany({ where: { id: { startsWith: `${P}-` } } });
    await db.idea.deleteMany({ where: { id: { startsWith: `${P}-` } } });
    await db.agent.deleteMany({ where: { id: { startsWith: `${P}-` } } });
    await db.membership.deleteMany({ where: { userId: { startsWith: `${P}-` } } });
    await db.user.deleteMany({ where: { id: { startsWith: `${P}-` } } });

    // People, their memberships, and their agents.
    const person = async (key: string, name: string, agents: string[]) => {
      const id = `${P}-user-${key}`;
      await db.user.create({ data: { id, name, email: `${key}@scenario.local` } });
      await db.membership.create({ data: { organisationId: ORGANISATION_ID, userId: id, role: "member" } });
      const agentIds: string[] = [];
      for (const [index, agentName] of agents.entries()) {
        const agentId = `${P}-agent-${key}-${index}`;
        await db.agent.create({ data: { id: agentId, ownerUserId: id, name: agentName, activations: { create: { organisationId: ORGANISATION_ID, level: "working" } } } });
        agentIds.push(agentId);
      }
      return { id, agentIds };
    };
    const nadia = await person("nadia", "Nadia Normal", ["Nadia's Claude"]);
    const felix = await person("felix", "Felix Farmer", ["Felix Bot 1", "Felix Bot 2"]);
    const sam = await person("sam", "Sam Spread", ["Sam's Codex"]);

    // The accounts that upvote: Bob Booster for Felix, and sixty different people for Sam.
    const bob = `${P}-user-bob`;
    await db.user.create({ data: { id: bob, name: "Bob Booster", email: "bob@scenario.local" } });
    const voters: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `${P}-user-voter-${i}`;
      await db.user.create({ data: { id, name: `Voter ${i + 1}`, email: `voter${i + 1}@scenario.local` } });
      voters.push(id);
    }

    // Felix's own ideas, which he then gives opinions on.
    const felixIdeas: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `${P}-idea-felix-${i}`;
      await db.idea.create({
        data: {
          id, organisationId: ORGANISATION_ID, projectId: PROJECT_ID, reporterId: felix.id, beneficiaryUserId: felix.id,
          title: `Felix's idea ${i + 1}: make the dashboard pop`, description: "Make it better. More colour, more everything.",
          createdAt: ago((10 - i) * DAY),
        },
      });
      felixIdeas.push(id);
    }

    const entries: Entry[] = [];

    // Nadia: delivered work first, a little of everything else.
    for (let i = 0; i < 4; i++) entries.push({ userId: nadia.id, agentId: nadia.agentIds[0], role: "solver", points: 750, sourceKey: `solver:${bugAt(i)}:${nadia.id}`, bugId: bugAt(i), createdAt: withinDays(14) });
    for (let i = 0; i < 6; i++) entries.push({ userId: nadia.id, agentId: nadia.agentIds[0], role: "reviewer", points: 300, sourceKey: `reviewer:${bugAt(10 + i)}:${nadia.id}`, bugId: bugAt(10 + i), createdAt: withinDays(14) });
    for (let i = 0; i < 5; i++) entries.push({ userId: nadia.id, agentId: nadia.agentIds[0], role: "reviewer", points: 90, sourceKey: `reviewer-confirm:${bugAt(20 + i)}:${nadia.id}`, bugId: bugAt(20 + i), createdAt: withinDays(14) });
    for (let i = 0; i < 2; i++) entries.push({ userId: nadia.id, agentId: null, role: "reporter", points: 150, sourceKey: `reporter:${bugAt(30 + i)}:${nadia.id}`, bugId: bugAt(30 + i), createdAt: withinDays(14) });
    for (let i = 0; i < 10; i++) entries.push({ userId: nadia.id, agentId: nadia.agentIds[0], role: "vote", points: 1, sourceKey: `importance:${bugAt(40 + i)}:${nadia.id}`, bugId: bugAt(40 + i), createdAt: withinDays(14) });
    entries.push({ userId: nadia.id, agentId: null, role: "signup", points: 100, sourceKey: `signup:${nadia.id}`, createdAt: ago(20 * DAY) });

    // Felix: upvotes mostly from Bob, a burst within one hour yesterday, importance by the hundred, opinions on his own ideas.
    for (let i = 0; i < 320; i++) {
      const burst = i < 60;
      entries.push({
        userId: felix.id, agentId: felix.agentIds[i % 2], role: "comment", points: 1,
        sourceKey: `comment-upvote:${P}-comment-felix-${i}:${bob}`, bugId: bugAt(i),
        createdAt: burst ? ago(DAY + Math.floor(random() * 50) * MIN) : withinDays(14),
      });
    }
    for (let i = 0; i < 80; i++) {
      entries.push({ userId: felix.id, agentId: felix.agentIds[i % 2], role: "comment", points: 1, sourceKey: `comment-upvote:${P}-comment-felix-x${i}:${voters[i % 8]}`, bugId: bugAt(100 + i), createdAt: withinDays(14) });
    }
    for (let i = 0; i < 150; i++) {
      entries.push({ userId: felix.id, agentId: felix.agentIds[i % 2], role: "vote", points: 1, sourceKey: `importance:${bugAt(i)}:${felix.id}`, bugId: bugAt(i), createdAt: withinDays(14) });
    }
    for (const [index, ideaId] of felixIdeas.entries()) {
      entries.push({ userId: felix.id, agentId: felix.agentIds[index % 2], role: "idea", points: 1, sourceKey: `idea:${ideaId}:${felix.id}`, ideaId, createdAt: withinDays(10) });
    }
    entries.push({ userId: felix.id, agentId: felix.agentIds[0], role: "solver", points: 750, sourceKey: `solver:${bugAt(60)}:${felix.id}`, bugId: bugAt(60), createdAt: withinDays(14) });
    // One award taken back: the original is marked corrected, and the correction is a negative entry.
    const takenBack = `${P}-pe-felix-taken-back`;
    entries.push({ id: takenBack, userId: felix.id, agentId: felix.agentIds[1], role: "reviewer", points: 300, sourceKey: `reviewer:${bugAt(61)}:${felix.id}`, bugId: bugAt(61), createdAt: ago(5 * DAY), correctedAt: ago(4 * DAY) });
    entries.push({ id: `${P}-pe-felix-correction`, userId: felix.id, agentId: felix.agentIds[1], role: "reviewer", points: -300, sourceKey: `undo:${takenBack}`, bugId: bugAt(61), createdAt: ago(4 * DAY) });
    entries.push({ userId: felix.id, agentId: null, role: "signup", points: 100, sourceKey: `signup:${felix.id}`, createdAt: ago(16 * DAY) });

    // Sam: hundreds of upvotes from sixty different people, five each, spread out.
    for (let i = 0; i < 300; i++) {
      entries.push({ userId: sam.id, agentId: sam.agentIds[0], role: "comment", points: 1, sourceKey: `comment-upvote:${P}-comment-sam-${i}:${voters[i % 60]}`, bugId: bugAt(i), createdAt: withinDays(14) });
    }
    entries.push({ userId: sam.id, agentId: sam.agentIds[0], role: "solver", points: 750, sourceKey: `solver:${bugAt(70)}:${sam.id}`, bugId: bugAt(70), createdAt: withinDays(14) });
    entries.push({ userId: sam.id, agentId: null, role: "signup", points: 100, sourceKey: `signup:${sam.id}`, createdAt: ago(18 * DAY) });

    await db.pointEntry.createMany({
      data: entries.map((entry, index) => ({
        id: entry.id ?? `${P}-pe-${index}`,
        organisationId: ORGANISATION_ID,
        userId: entry.userId,
        agentId: entry.agentId,
        role: entry.role,
        // The amounts above are the old point figures; the ledger is in $ (#z-currency), 100 points to $1.
        points: entry.points / 100,
        sourceKey: entry.sourceKey,
        bugId: entry.bugId ?? null,
        ideaId: entry.ideaId ?? null,
        createdAt: entry.createdAt,
        correctedAt: entry.correctedAt ?? null,
      })),
    });

    const base = process.env.SCENARIO_BASE_URL ?? "http://localhost:3001";
    console.log(`Wrote ${entries.length} ledger entries for three people in the Demo organisation.`);
    console.log("Sign in as demo@fixtures.local and open:");
    console.log(`  Nadia Normal (honest):  ${base}/users/${nadia.id}`);
    console.log(`  Felix Farmer (farmed):  ${base}/users/${felix.id}`);
    console.log(`  Sam Spread (spread):    ${base}/users/${sam.id}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
