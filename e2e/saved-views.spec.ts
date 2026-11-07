import { test, expect, PROJECT, expectNoHorizontalScroll } from "./fixtures";

test("saves and reopens a filtered issue view, then deletes it", async ({ page, uniq }) => {
  const name = uniq("My login queue");
  await page.goto(PROJECT + "/issues/open?q=login&sort=title");
  await page.getByText("Saved views", { exact: true }).click();
  await page.getByLabel("View name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save current view", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "View saved." })).toBeVisible();
  await page.goto(PROJECT + "/issues/all");
  await page.getByText("Saved views", { exact: true }).click();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/issues/open\\?q=login&sort=title$"));
  await page.locator("details").filter({ has: page.getByText("Saved views", { exact: true }) }).evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Delete view " + name, exact: true }).click();
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
});
