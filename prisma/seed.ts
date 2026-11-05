import { Prisma, PrismaClient, Status, Substatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const MIN_SUPER_ADMIN_PASSWORD_LENGTH = 12;

async function ensureZeduOwnerMembership(
  userId: string,
  tx: Prisma.TransactionClient,
) {
  const tenant = await tx.tenant.upsert({
    where: { slug: "zedu" },
    update: {},
    create: { slug: "zedu", name: "Ziki" },
  });

  await tx.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId } },
    update: { role: "owner" },
    create: { tenantId: tenant.id, userId, role: "owner" },
  });
}

/**
 * Idempotent super-admin provisioning from env.
 * - Creates the account when missing
 * - Leaves an existing super_admin unchanged unless SUPER_ADMIN_FORCE_UPDATE=true
 * - With force update, promotes/rotates credentials for the configured email
 */
async function ensureSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const forceUpdate = process.env.SUPER_ADMIN_FORCE_UPDATE === "true";
  const name = process.env.SUPER_ADMIN_NAME?.trim() || "Super Admin";

  if (!email || !password) {
    console.log(
      "Skipping super admin seed (set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD).",
    );
    return;
  }

  if (password.length < MIN_SUPER_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `SUPER_ADMIN_PASSWORD must be at least ${MIN_SUPER_ADMIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role === "super_admin" && !forceUpdate) {
      await prisma.$transaction((tx) => ensureZeduOwnerMembership(existing.id, tx));
      console.log(`Super admin already exists (${email}); leaving unchanged.`);
      return;
    }

    if (!forceUpdate) {
      console.log(
        `User ${email} exists with role=${existing.role}; left unchanged. Set SUPER_ADMIN_FORCE_UPDATE=true to promote and set password.`,
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.id },
        data: {
          role: "super_admin",
          passwordHash,
          name,
        },
      });
      await ensureZeduOwnerMembership(existing.id, tx);
    });
    console.log(`Updated super admin (${email}).`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "super_admin",
        emailVerified: new Date(),
      },
    });
    await ensureZeduOwnerMembership(user.id, tx);
  });
  console.log(`Created super admin (${email}).`);
}

async function seedDemoData() {
  await prisma.vote.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.bug.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("12345678", 10);

  const alice = await prisma.user.create({
    data: {
      name: "Alice Mentor",
      email: "alice@zendor.dev",
      passwordHash,
      role: "admin",
    },
  });
  const bob = await prisma.user.create({
    data: {
      name: "Bob Builder",
      email: "bob@zendor.dev",
      passwordHash,
    },
  });
  const cara = await prisma.user.create({
    data: {
      name: "Cara QA",
      email: "cara@zendor.dev",
      passwordHash,
    },
  });

  // The migration creates Zedu (#423); upsert so a seed never depends on it.
  const tenant = await prisma.tenant.upsert({
    where: { slug: "zedu" },
    update: {},
    create: { slug: "zedu", name: "Ziki" },
  });
  const project = await prisma.project.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "zedu" } },
    update: {},
    create: { tenantId: tenant.id, slug: "zedu", name: "Ziki", workflow: { create: {} } },
  });
  // A project seeded before #595 has no workflow row yet.
  await prisma.projectWorkflow.upsert({
    where: { projectId: project.id },
    update: {},
    create: { projectId: project.id },
  });
  const zedu = { tenantId: tenant.id, projectId: project.id };
  await prisma.membership.createMany({
    data: [alice, bob, cara].map((user) => ({ tenantId: tenant.id, userId: user.id })),
    skipDuplicates: true,
  });

  const samples: Array<{
    title: string;
    description: string;
    status: Status;
    substatus: Substatus;
    reporterId: string;
    assigneeId?: string;
    proofLinks?: string[];
  }> = [
    {
      title: "Login button unresponsive on mobile Safari",
      description:
        "Tapping Sign in on iPhone 14 (iOS 18) does nothing. Console shows no network request. Repro: clear site data, open /login, enter credentials, tap button. Proof: first link is the frozen button; second is a screen recording of the tap.",
      status: "open",
      substatus: "open",
      reporterId: cara.id,
      assigneeId: bob.id,
      proofLinks: [
        "https://example.com/proof/login-button-frozen.png",
        "https://example.com/proof/login-tap-recording.mp4",
      ],
    },
    {
      title: "Bug list filter resets after navigation",
      description:
        "Selecting status=in_progress then opening a bug and going back loses the filter. Expected: preserve query params.",
      status: "in_progress",
      substatus: "in_progress",
      reporterId: alice.id,
      assigneeId: alice.id,
    },
    {
      title: "Critical: seed script wipes production",
      description:
        "Running pnpm db:seed against a non-local DATABASE_URL deletes all rows. Add an environment guard before deleteMany. Screenshot shows wipe on staging.",
      status: "open",
      substatus: "open",
      reporterId: bob.id,
      proofLinks: ["https://example.com/proof/seed-wipe-staging.png"],
    },
    {
      title: "Comment timestamps show UTC only",
      description:
        "Detail page renders createdAt without local timezone. Prefer relative time or locale formatting.",
      status: "resolved",
      substatus: "on_prod",
      reporterId: cara.id,
      assigneeId: alice.id,
    },
    {
      title: "Assignee dropdown missing empty option",
      description:
        "Cannot unassign a bug once assigned. Need an Unassigned option that sets assigneeId null.",
      status: "open",
      substatus: "open",
      reporterId: bob.id,
      assigneeId: cara.id,
    },
    {
      title: "Empty state copy too vague",
      description:
        "When filters match nothing, show Clear filters CTA instead of a blank panel.",
      status: "closed",
      substatus: "closed",
      reporterId: alice.id,
      assigneeId: bob.id,
    },
    {
      title: "Status badge contrast fails WCAG AA",
      description:
        "Yellow status badge on white background is ~2.8:1. Darken text or badge background. Link shows contrast check.",
      status: "in_progress",
      substatus: "in_progress",
      reporterId: cara.id,
      assigneeId: bob.id,
      proofLinks: ["https://example.com/proof/contrast-audit.png"],
    },
    {
      title: "Create bug allows blank description via spaces",
      description:
        "Trimming is missing on the server for description-only-whitespace. Zod trim should reject it.",
      status: "open",
      substatus: "open",
      reporterId: alice.id,
    },
  ];

  const bugs = [];
  for (const sample of samples) {
    const bug = await prisma.bug.create({
      data: { ...sample, ...zedu, beneficiaryUserId: sample.reporterId },
    });
    await prisma.comment.create({
      data: {
        bugId: bug.id,
        authorId: sample.reporterId,
        body: "Initial report filed during Zedu Bugs mini-project kickoff.",
      },
    });
    bugs.push(bug);
  }

  // Seed votes so list sorting by popularity is visible out of the box.
  const votePairs: Array<{ userId: string; bugId: string }> = [
    { userId: alice.id, bugId: bugs[0].id },
    { userId: bob.id, bugId: bugs[0].id },
    { userId: cara.id, bugId: bugs[0].id },
    { userId: alice.id, bugId: bugs[2].id },
    { userId: bob.id, bugId: bugs[2].id },
    { userId: cara.id, bugId: bugs[6].id },
    { userId: alice.id, bugId: bugs[7].id },
  ];

  for (const vote of votePairs) {
    await prisma.vote.create({ data: vote });
    await prisma.bug.update({
      where: { id: vote.bugId },
      data: { voteCount: { increment: 1 } },
    });
  }

  console.log("Seeded 3 demo users, 8 bugs, and sample votes.");
  console.log("Demo login: alice@zendor.dev / 12345678 (admin)");
}

async function ensureDefaultTypes() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: "zedu" }, select: { id: true } });
  if (!tenant) {
    console.log("Skipping default issue types: the Zedu organization is missing.");
    return;
  }
  const count = await prisma.issueType.count({ where: { tenantId: tenant.id } });
  if (count > 0) {
    return;
  }

  const defaults = [
    { name: "Marketing", description: "Marketing and promotion related tasks" },
    { name: "Design", description: "UI/UX and visual design tasks" },
    { name: "Fix", description: "Bug fixes and defect resolutions" },
    { name: "Feat", description: "New features and enhancements" },
  ];

  for (const item of defaults) {
    await prisma.issueType.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: item.name } },
      update: {},
      create: {
        tenantId: tenant.id,
        name: item.name,
        description: item.description,
        isActive: true,
      },
    });
  }
  console.log("Ensured default issue types (Marketing, Design, Fix, Feat).");
}

async function main() {
  const wasEmpty = (await prisma.user.count()) === 0;

  // Always idempotent; safe when a DB already has real accounts.
  await ensureSuperAdmin();
  await ensureDefaultTypes();

  const seedDemo =
    process.env.SEED_DEMO_DATA === "true" ||
    (wasEmpty && process.env.SEED_DEMO_DATA !== "false");

  // Demo users share the password 12345678 — never load them into production.
  if (
    seedDemo &&
    process.env.NODE_ENV === "production" &&
    process.env.SEED_DEMO_DATA_IN_PRODUCTION !== "true"
  ) {
    console.log(
      "Demo data seed refused: NODE_ENV=production. Demo accounts use a known password.",
    );
    return;
  }

  if (!seedDemo) {
    console.log(
      "Demo data seed skipped (DB not empty). Set SEED_DEMO_DATA=true to force sample data (wipes users/bugs).",
    );
    return;
  }

  await seedDemoData();
  // Demo wipe removes the super admin — restore from env afterward.
  await ensureSuperAdmin();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
