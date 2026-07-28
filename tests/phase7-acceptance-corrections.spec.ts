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

test("frontend navigation keeps a direct demo route safe for visitors", async ({ page }) => {
  await page.goto("/demo");
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Demo 模式")).toHaveCount(0);
  await expect(page.getByText("PureHub 产品演示")).toHaveCount(0);
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

test("homepage purchase unlock dialog covers the viewport outside the post card", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("post-card").filter({ has: page.getByRole("heading", { name: "雨后竹林写真日记", exact: true }) });
  await card.getByRole("button", { name: "解锁图片 3" }).click();

  const dialog = page.getByRole("dialog", { name: "解锁作品" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.parentElement === document.body)).toBe(true);
  const box = await dialog.boundingBox();
  expect(box?.width).toBe(page.viewportSize()?.width);
  expect(box?.height).toBe(page.viewportSize()?.height);
  await expect(dialog.getByRole("link", { name: "登录后解锁" })).toBeVisible();
  await expect(dialog.locator('input[value="4242 4242 4242 4242"]')).toHaveCount(0);
});

test("homepage purchase unlock dialog closes on Escape and restores locked-media focus", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("post-card").filter({ has: page.getByRole("heading", { name: "雨后竹林写真日记", exact: true }) });
  const lockedMedia = card.getByRole("button", { name: "解锁图片 3" });
  await lockedMedia.focus();
  await lockedMedia.press("Enter");
  await expect(page.getByRole("dialog", { name: "解锁作品" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "解锁作品" })).toHaveCount(0);
  await expect(lockedMedia).toBeFocused();
});

test("homepage purchase unlock dialog moves focus inside and traps Tab navigation", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mobile emulation does not advance focus with a virtual Tab key; desktop verifies keyboard focus containment.");
  await page.goto("/");
  const card = page.getByTestId("post-card").filter({ has: page.getByRole("heading", { name: "雨后竹林写真日记", exact: true }) });
  await card.getByRole("button", { name: "解锁图片 3" }).click();

  const dialog = page.getByRole("dialog", { name: "解锁作品" });
  const close = dialog.getByRole("button", { name: "关闭解锁窗口" });
  const back = dialog.getByRole("button", { name: "返回" });
  const signIn = dialog.getByRole("link", { name: "登录后解锁" });
  await expect(close).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(back).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(signIn).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(signIn).toBeFocused();
});
