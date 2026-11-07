import { test, expect, expectNoHorizontalScroll, PROJECT } from "./fixtures";
import { e2eDb } from "./db";
import { authFile, emailFor, type Width } from "./users";
import { randomUUID } from "node:crypto";

// Provider-independent setup: browser coverage starts with a proposal, never a production AI bypass.
async function savedProposal(width: Width, title: string) {
  const db = e2eDb();
  try {
    const owner = await db.user.findUniqueOrThrow({ where: { email: emailFor("user", width) } });
    return await db.featurePlan.create({ data: {
      id: randomUUID(), projectId: "project_zedu", creatorId: owner.id, title,
      request: "Customers should book an available appointment and receive confirmation.",
      draft: { outcome: "Customers can book an appointment and see confirmation.", definitionOfDone: ["A booked time is reserved and confirmation is shown."],
        tasks: [{ title: "Reserve an appointment", description: "Customers can choose an available time and confirm their booking.", acceptanceCriteria: ["A booking removes that time from availability."], scope: "first", existing: null }] },
    } });
  } finally { await db.$disconnect(); }
}

test("reviews a private feature plan and publishes first and later work separately", async ({ page, browser, uniq, width }) => {
  const title = uniq("Appointment booking");
  const first = uniq("Reserve an appointment");
  const later = uniq("Reschedule an appointment");
  const proposal = await savedProposal(width, title);
  await page.goto(`${PROJECT}/features/${proposal.id}?edit=1`);
  await page.getByText("Edit proposal (optional)", { exact: true }).click();
  await page.getByLabel("The user outcome").fill("Customers can book an appointment and see confirmation.");
  await page.getByRole("textbox", { name: "Definition of done 1", exact: true }).fill("A booked time is reserved and confirmation is shown.");
  const item1 = page.getByRole("group", { name: "Work item 1", exact: true });
  await item1.getByLabel("Title", { exact: true }).fill(first);
  await item1.getByLabel("What should change?").fill("Customers can choose an available time and confirm their booking.");
  await item1.getByRole("textbox", { name: "Item 1 acceptance criteria 1", exact: true }).fill("A booking removes that time from availability.");
  await page.getByRole("button", { name: "Add work item" }).click();
  const item2 = page.getByRole("group", { name: "Work item 2", exact: true });
  await item2.getByLabel("Title", { exact: true }).fill(later);
  await item2.getByLabel("What should change?").fill("Customers can move an existing booking to another available time.");
  await item2.getByRole("textbox", { name: "Item 2 acceptance criteria 1", exact: true }).fill("The original time becomes available after rescheduling.");
  await item2.getByRole("combobox", { name: "Scope", exact: true }).selectOption("later");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Save draft and review" }).click();
  await expect(page).toHaveURL(/\/features\/[a-f0-9-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const planId = new URL(page.url()).pathname.split("/").pop()!;
  const db = e2eDb();
  const otherMember = await browser.newContext({ storageState: authFile("admin", width) });
  try {
    const saved = await db.featurePlan.findUniqueOrThrow({ where: { id: planId }, include: { items: true } });
    const owner = await db.user.findUniqueOrThrow({ where: { email: emailFor("user", width) } });
    expect(saved.creatorId).toBe(owner.id);
    expect(saved.publishedAt).toBeNull();
    expect(saved.items).toHaveLength(0);
    expect(await db.idea.count({ where: { projectId: saved.projectId, title: { in: [first, later] } } })).toBe(0);
    const privatePage = await otherMember.request.get(page.url());
    expect(privatePage.status()).toBe(404);
    await page.getByRole("button", { name: "Publish first version", exact: true }).click();
    await expect(page.getByRole("link", { name: /Idea #\d+ · open/ })).toHaveCount(1);
    await page.reload();
    const sharedPage = await otherMember.request.get(page.url());
    expect(sharedPage.status()).toBe(200);
    expect(await sharedPage.text()).toContain(title);
    expect(await db.idea.count({ where: { projectId: saved.projectId, title: first } })).toBe(1);
    expect(await db.idea.count({ where: { projectId: saved.projectId, title: later } })).toBe(0);
    const idea = await db.idea.findFirstOrThrow({ where: { projectId: saved.projectId, title: first } });
    expect(idea.status).toBe("open");
    expect(idea.issueId).toBeNull();
    expect(idea.description).toContain("A booked time is reserved and confirmation is shown.");
    expect(idea.description).toContain(`/features/${planId}`);
    await page.getByRole("button", { name: "Publish later improvements", exact: true }).click();
    await expect(page.getByRole("link", { name: /Idea #\d+ · open/ })).toHaveCount(2);
    await page.reload();
    expect(await db.featurePlanItem.count({ where: { planId } })).toBe(2);
    expect(await db.idea.count({ where: { projectId: saved.projectId, title: { in: [first, later] } } })).toBe(2);
    await expectNoHorizontalScroll(page);
  } finally { await otherMember.close(); await db.$disconnect(); }
});

test("reviews existing work before linking it without creating a duplicate", async ({ page, uniq, width }) => {
  const db = e2eDb();
  try {
    const owner = await db.user.findUniqueOrThrow({ where: { email: emailFor("user", width) } });
    const title = uniq("Reuse appointment availability");
    const existing = await db.idea.create({ data: {
      organisationId: "organisation_zedu", projectId: "project_zedu", reporterId: owner.id, beneficiaryUserId: owner.id,
      title, description: "Provide available appointment times for customers to choose from.",
    } });
    const featureName = uniq("Booking with existing availability");
    const proposal = await savedProposal(width, featureName);
    await page.goto(`${PROJECT}/features/${proposal.id}?edit=1`);
    await page.getByText("Edit proposal (optional)", { exact: true }).click();
    await page.getByLabel("The user outcome").fill("Customers can choose an available appointment time.");
    await page.getByRole("textbox", { name: "Definition of done 1", exact: true }).fill("An available appointment can be selected.");
    await page.getByLabel("Search ideas and issues").fill(title);
    await page.getByRole("button", { name: "Find work", exact: true }).click();
    const item = page.getByRole("group", { name: "Work item 1", exact: true });
    await item.getByLabel("Title", { exact: true }).fill(title);
    await item.getByLabel("What should change?").fill("Reuse the existing availability proposal for appointment selection.");
    await item.getByRole("textbox", { name: "Item 1 acceptance criteria 1", exact: true }).fill("Available times can be selected.");
    await item.getByLabel("Reuse existing work or create a new idea").selectOption(`idea:${existing.id}`);
    await page.getByRole("button", { name: "Save draft and review" }).click();
    await expect(page.getByRole("heading", { name: featureName, exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: `Idea #${existing.number} · open · Not linked yet`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Publish first version", exact: true }).click();
    await expect(page.getByRole("link", { name: `Idea #${existing.number} · open`, exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await db.idea.count({ where: { projectId: "project_zedu", title } })).toBe(1);
    await expectNoHorizontalScroll(page);
  } finally { await db.$disconnect(); }
});
