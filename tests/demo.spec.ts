import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { CONTENT_CATEGORIES } from "../lib/categories";

test("default gallery assets are complete", async () => {
  const seen = new Set<string>();
  for (let post = 1; post <= 36; post++) {
    const dir = path.join(process.cwd(), "public", "generated", "posts", `post-${post}`);
    expect(fs.existsSync(dir), `post-${post} gallery directory`).toBeTruthy();
    const images = fs.readdirSync(dir).filter((name) => /\.webp$/i.test(name)).sort();
    expect(images, `post-${post} image count`).toHaveLength(12);
    for (let index = 1; index <= 12; index++) {
      const filename = `${String(index).padStart(2, "0")}.webp`;
      expect(images).toContain(filename);
      const fullPath = path.join(dir, filename);
      seen.add(fullPath);
      expect(fs.statSync(fullPath).size, fullPath).toBeGreaterThan(8_000);
    }
  }
  expect(seen.size).toBe(432);
});

test("core pages are reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("article").first()).toBeVisible();
  await page.goto("/explore");
  await expect(page.locator("main")).toBeVisible();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).toBeVisible();
});

test("demo state can be reset", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: /重置/ }).click();
  await expect(page.getByRole("status")).toContainText("Demo");
});

test("home uses configured categories and filters content", async ({ page }) => {
  await page.goto("/");
  for (const category of CONTENT_CATEGORIES) {
    const tab = page.getByRole("button", { name: category, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page.locator("article").first()).toBeVisible();
  }
  for (const legacy of ["数字艺术", "摄影", "动画", "音乐", "设计", "游戏"]) {
    await expect(page.getByRole("button", { name: legacy, exact: true })).toHaveCount(0);
  }
});

test("SM and male creator profile pages are reachable", async ({ page }) => {
  await page.goto("/creator/nora");
  await expect(page.getByRole("heading", { name: /Nora/ })).toBeVisible();
  await page.goto("/creator/shenyue");
  await expect(page.getByRole("heading", { name: /沈越/ })).toBeVisible();
});

test("post cards show eight previews and lead members to unlock", async ({ page }) => {
  await page.goto("/");
  const memberPost = page.locator("article").filter({ has: page.getByRole("link", { name: "Momo Studio" }) }).first();
  await expect(memberPost.getByTestId("post-card-gallery").locator("button")).toHaveCount(8);
  const lockedImage = memberPost.getByRole("button", { name: /3/ });
  await expect(lockedImage).toBeVisible();
  await lockedImage.click();
  await expect(page).toHaveURL(/\/membership\/momo/, { timeout: 5000 });
  await expect(page.locator("main")).toBeVisible();
});

test("single purchase unlocks full post gallery after payment", async ({ page }) => {
  await page.goto("/post/post-4");
  const gallery = page.getByTestId("post-detail-gallery");
  await expect(gallery.locator("button")).toHaveCount(8);
  await gallery.getByRole("button", { name: /3/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /确认支付/ }).click();
  await page.getByRole("button", { name: /查看全部 12/ }).click();
  await expect(gallery.locator("button")).toHaveCount(12);
});

test("free posts support expanded gallery and keyboard lightbox", async ({ page }) => {
  await page.goto("/post/post-1");
  const gallery = page.getByTestId("post-detail-gallery");
  const expandButton = page.getByRole("button", { name: /12/ });
  await expandButton.scrollIntoViewIfNeeded();
  await expect(expandButton).toBeVisible();
  await expandButton.click();
  await expect(gallery.locator("button")).toHaveCount(12);
  await gallery.locator("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("2 / 12")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});



