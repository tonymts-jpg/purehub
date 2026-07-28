import { expect, test, type TestInfo } from "@playwright/test";
import { hasDatabase, signInAdmin, signInCreator, signInFan } from "./auth-helpers";

test("frontend navigation hides demo, admin, and creator tools for visitors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("site-shell")).toBeVisible();
  await expect(page.getByText("Demo 模式")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "站务后台" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "博主工作台" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "发布作品" })).toHaveCount(0);
});

test("frontend navigation derives fan and approved creator states from the session", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop navigation acceptance covers the desktop-only creator controls.");
  test.skip(!(await hasDatabase(page.request)), "Authenticated navigation requires the seeded PostgreSQL database.");
  await signInFan(page.request);
  await page.goto("/");
  await page.reload();
  await expect(page.getByText("Pure 粉丝", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "博主工作台" })).toHaveCount(0);

  await signInCreator(page.request);
  await page.reload();
  await expect(page.getByText("博主", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "博主工作台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "发布作品" })).toBeVisible();
});

test("admin uses an independent shell without frontend navigation", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Admin UI sessions require the seeded database.");
  await signInAdmin(page.request);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-shell")).toBeVisible();
  await expect(page.getByTestId("site-shell")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "首页" })).toHaveCount(0);
  await expect(page.getByText("Demo 模式")).toHaveCount(0);
});
