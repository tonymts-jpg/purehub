import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

test("default gallery assets are complete", async () => {
  const seen = new Set<string>();
  for (let post = 1; post <= 18; post++) {
    const dir = path.join(process.cwd(), "public", "generated", "posts", `post-${post}`);
    expect(fs.existsSync(dir), `post-${post} gallery directory`).toBeTruthy();
    const images = fs.readdirSync(dir).filter((name) => /\.webp$/i.test(name)).sort();
    expect(images, `post-${post} image count`).toHaveLength(12);
    for (let index = 1; index <= 12; index++) {
      const filename = `${String(index).padStart(2, "0")}.webp`;
      expect(images).toContain(filename);
      const fullPath = path.join(dir, filename);
      seen.add(fullPath);
      expect(fs.statSync(fullPath).size, fullPath).toBeGreaterThan(10_000);
    }
  }
  expect(seen.size).toBe(216);
});

test("核心页面可以访问", async ({page}) => {
  await page.goto("/");
  await expect(page.getByText("让热爱成为")).toBeVisible();
  await page.goto("/explore");
  await expect(page.getByText("发现你的下一份热爱")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText("90 天收入趋势")).toBeVisible();
});

test("可以重置 Demo", async ({page}) => {
  await page.goto("/demo");
  await page.getByRole("button",{name:"重置"}).click();
  await expect(page.getByRole("status")).toHaveText("Demo 数据已重置");
});

test("首页使用五个新分类并可筛选内容", async ({page}) => {
  await page.goto("/");
  for (const category of ["Cosplay","美足","調教","戶外","R18"]) {
    const tab = page.getByRole("button",{name:category,exact:true});
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page.locator("article").first()).toBeVisible();
  }
  for (const legacy of ["数字艺术","摄影","动画","音乐","设计","游戏"]) {
    await expect(page.getByRole("button",{name:legacy,exact:true})).toHaveCount(0);
  }
});

test("作品卡显示八张预览并引导会员解锁", async ({page}) => {
  await page.goto("/");
  const memberPost=page.locator("article").filter({has:page.getByRole("link",{name:"Momo Studio"})}).first();
  await expect(memberPost.getByTestId("post-card-gallery").locator("button")).toHaveCount(8);
  const lockedImage=memberPost.getByRole("button",{name:"解锁图片 3"});
  await expect(lockedImage).toBeVisible();
  await expect(async () => {
    await lockedImage.click();
    await expect(page).toHaveURL(/\/membership\/momo/,{timeout:1000});
  }).toPass();
});

test("单次购买作品付款后立即显示完整图片", async ({page}) => {
  await page.goto("/post/post-4");
  const gallery=page.getByTestId("post-detail-gallery");
  await expect(gallery.locator("button")).toHaveCount(8);
  await gallery.getByRole("button",{name:"解锁图片 3"}).click();
  await expect(page.getByRole("dialog",{name:"解锁完整图片"})).toBeVisible();
  await page.getByRole("button",{name:/确认支付/}).click();
  await expect(page.getByText("完整 12 张图片已解锁")).toBeVisible();
  await page.getByRole("button",{name:"查看全部 12 张"}).click();
  await expect(gallery.locator("button")).toHaveCount(12);
  await expect(gallery.getByRole("button",{name:"查看图片 12"})).toBeVisible();
});

test("免费作品支持展开画廊和键盘灯箱", async ({page}) => {
  await page.goto("/post/post-1");
  const gallery=page.getByTestId("post-detail-gallery");
  const expandButton=page.getByRole("button",{name:"查看全部 12 张"});
  await expandButton.scrollIntoViewIfNeeded();
  await expect(expandButton).toBeVisible();
  await expandButton.click();
  await expect(gallery.locator("button")).toHaveCount(12);
  await gallery.getByRole("button",{name:"查看图片 1",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"图片预览"})).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("2 / 12")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog",{name:"图片预览"})).toHaveCount(0);
});
