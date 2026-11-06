import { test, expect, expectNoHorizontalScroll, PROJECT } from "./fixtures";

test.describe("organisation admin screens", () => {
  test.use({ as: "admin" });

  test("adds an issue type", async ({ page, uniq }) => {
    const name = uniq("Docs").slice(0, 45);
    await page.goto(`${PROJECT}/org/types`);
    await page.getByRole("button", { name: "Add new type" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create type" }).click();
    await expect(page.getByRole("cell", { name }).or(page.getByText(name)).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("a normal member reads them but can't change them", async ({ browser, width }) => {
    const { authFile } = await import("./users");
    const context = await browser.newContext({ storageState: authFile("user", width) });
    const page = await context.newPage();
    await page.goto(`${PROJECT}/org/types`);
    await expect(page.getByRole("button", { name: "Add new type" })).toHaveCount(0);
    await context.close();
  });

  test("an organisation admin can't open the site admin pages", async ({ page }) => {
    await page.goto("/superadmin/users");
    await expect(page).not.toHaveURL(/\/superadmin\/users/);
  });
});

test.describe("super admin", () => {
  test.use({ as: "super" });

  test("sees the site admin page", async ({ page }) => {
    await page.goto("/superadmin");
    await expect(page).toHaveURL(/\/superadmin\/users/);
    await expect(page.getByRole("heading", { name: /admin/i }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
