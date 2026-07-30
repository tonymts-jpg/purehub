import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { posts as seededPosts } from "../lib/data";
import { prisma } from "../lib/prisma";
import { authHeaders, hasDatabase, signInAdmin, signInCreator, signInFan } from "./auth-helpers";

async function useSeededHomeFeed(page: Page) {
  await page.route("**/api/feed*", (route) => route.fulfill({
    json: { posts: seededPosts, nextCursor: null }
  }));
}

test("staging does not retain Phase 6 ownership test posts", async ({ request }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Database cleanup acceptance runs once against the shared staging database.");
  test.skip(!(await hasDatabase(request)), "Phase 6 cleanup verification requires the seeded PostgreSQL database.");

  const leaked = await prisma.post.findMany({
    where: { title: { startsWith: "Phase 6 ownership" } },
    select: { id: true }
  });
  expect(leaked).toEqual([]);
});

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

test("visitors read visible comments and see a sign-in action instead of an editor", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Public seeded comments require the seeded PostgreSQL database.");
  const response = await page.request.get("/api/posts/post-1/comments");
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).comments.length).toBeGreaterThan(0);

  await page.goto("/post/post-1");
  await expect(page.getByTestId("comment-list").getByText("Pure 粉丝")).toBeVisible();
  await expect(page.getByRole("link", { name: "登录后参与评论" })).toBeVisible();
  await expect(page.getByPlaceholder("说说你的感受…")).toHaveCount(0);
});

test("authenticated users see the comment editor", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Comment participation requires the seeded PostgreSQL database.");
  await signInFan(page.request);
  await page.goto("/post/post-1");
  await expect(page.getByPlaceholder("说说你的感受…")).toBeVisible();
  await expect(page.getByRole("button", { name: "发布" })).toBeVisible();
});

test("homepage purchase unlock dialog covers the viewport outside the post card", async ({ page }) => {
  await useSeededHomeFeed(page);
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
  await useSeededHomeFeed(page);
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
  await useSeededHomeFeed(page);
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

test("authenticated homepage purchase uses the payment APIs and reloads authoritative access", async ({ page }) => {
  let purchased = false;
  const paymentCalls: string[] = [];
  let releaseConfirmation: (() => void) | undefined;
  const confirmationGate = new Promise<void>((resolve) => {
    releaseConfirmation = resolve;
  });
  const post = {
    id: "homepage-payment-contract",
    creatorId: "c1",
    title: "Homepage payment contract",
    excerpt: "The homepage must persist a real entitlement after payment.",
    content: "This fixture verifies the authenticated homepage purchase contract.",
    cover: "cover-1",
    category: "Cosplay",
    tags: ["Cosplay"],
    visibility: "purchase",
    price: 28,
    likes: 0,
    comments: [],
    createdAt: "刚刚",
    hasAccess: false,
    media: Array.from({ length: 3 }, (_, index) => ({
      id: `homepage-payment-media-${index + 1}`,
      src: "/generated/posts/post-1/01.webp",
      alt: `Homepage payment media ${index + 1}`,
      width: 720,
      height: 900,
      order: index,
      kind: "image"
    }))
  };

  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      json: {
        session: {
          id: "homepage-payment-session",
          userId: "homepage-payment-fan",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          token: "homepage-payment-token",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        user: {
          id: "homepage-payment-fan",
          name: "Homepage Payment Fan",
          email: "homepage-payment@example.com",
          emailVerified: true,
          image: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          role: "fan",
          creatorStatus: "none"
        }
      }
    });
  });
  await page.route("**/api/feed", async (route) => {
    await route.fulfill({ json: { posts: [{ ...post, hasAccess: purchased }], nextCursor: null } });
  });
  await page.route("**/api/payments/orders", async (route) => {
    paymentCalls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { order: { id: "homepage-payment-order" } } });
  });
  await page.route("**/api/payments/intents", async (route) => {
    paymentCalls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { intent: { id: "homepage-payment-intent" } } });
  });
  await page.route("**/api/payments/intents/homepage-payment-intent/confirm", async (route) => {
    paymentCalls.push(new URL(route.request().url()).pathname);
    await confirmationGate;
    purchased = true;
    await route.fulfill({ json: { intent: { id: "homepage-payment-intent", status: "succeeded" } } });
  });
  await page.route("**/api/posts/homepage-payment-contract", async (route) => {
    await route.fulfill({ json: { post: { ...post, hasAccess: purchased } } });
  });

  await page.goto("/");
  const card = page.getByTestId("post-card").filter({ has: page.getByRole("heading", { name: post.title }) });
  await card.getByRole("button", { name: "解锁图片 3" }).click();
  const dialog = page.getByRole("dialog", { name: "解锁作品" });
  await dialog.getByRole("button", { name: "确认支付 ¥28" }).click();
  await expect(dialog.getByRole("button", { name: "处理中…" })).toBeDisabled();
  releaseConfirmation?.();

  await expect(card.getByRole("button", { name: "查看图片 3" })).toBeVisible();
  expect(paymentCalls).toEqual([
    "/api/payments/orders",
    "/api/payments/intents",
    "/api/payments/intents/homepage-payment-intent/confirm"
  ]);

  await page.reload();
  await expect(page.getByTestId("post-card").filter({ has: page.getByRole("heading", { name: post.title }) }).getByRole("button", { name: "查看图片 3" })).toBeVisible();
});

test("authenticated homepage purchase creates a persistent entitlement", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared staging payment mutation runs once.");
  test.skip(!(await hasDatabase(page.request)), "Persistent homepage purchase requires PostgreSQL.");
  const nonce = Date.now().toString(36);
  let postId: string | null = null;
  let priorCard: Record<string, unknown> | null = null;

  try {
    await signInAdmin(page.request);
    const channels = await page.request.get("/api/admin/payment-channels");
    expect(channels.ok(), await channels.text()).toBeTruthy();
    priorCard = (await channels.json()).channels.find(({ provider }: { provider: string }) => provider === "card");
    const enabled = await page.request.patch("/api/admin/payment-channels/card", {
      headers: authHeaders,
      data: { enabled: true, mode: "test", statusNote: "acceptance_homepage_purchase", config: { adapter: "manual_confirm" } }
    });
    expect(enabled.ok(), await enabled.text()).toBeTruthy();

    await signInCreator(page.request);
    const created = await page.request.post("/api/posts", {
      data: {
        title: `Homepage purchase ${nonce}`,
        excerpt: "Authenticated homepage purchase acceptance fixture.",
        content: "This purchase fixture proves the entitlement survives a full homepage reload.",
        category: "Cosplay",
        contentType: "photo_short",
        saleMode: "single_plus_subscription",
        visibility: "purchase",
        price: 28
      }
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    postId = (await created.json()).post.id;
    await prisma.mediaAsset.createMany({
      data: Array.from({ length: 3 }, (_, index) => ({
        id: `homepage-purchase-${nonce}-${index + 1}`,
        postId,
        src: "/generated/posts/post-1/01.webp",
        alt: `Homepage purchase fixture ${index + 1}`,
        width: 720,
        height: 900,
        order: index,
        kind: "image",
        status: "ready",
        visibility: "purchase"
      }))
    });

    await signInFan(page.request);
    await page.goto("/");
    const card = page.locator(`[data-post-id="${postId}"]`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "解锁图片 3" }).click();
    await page.getByRole("dialog", { name: "解锁作品" }).getByRole("button", { name: "确认支付 ¥28" }).click();
    await expect(card.getByRole("button", { name: "查看图片 3" })).toBeVisible();

    const entitlement = await prisma.entitlement.findFirst({ where: { userId: "fan-demo", postId: postId! } });
    expect(entitlement).not.toBeNull();
    expect((await page.request.get(`/api/posts/${postId}`)).ok()).toBeTruthy();

    await page.reload();
    await expect(page.locator(`[data-post-id="${postId}"]`).getByRole("button", { name: "查看图片 3" })).toBeVisible();
  } finally {
    if (postId) {
      await prisma.searchDocument.deleteMany({ where: { entityType: "post", entityId: postId } }).catch(() => undefined);
      await prisma.post.deleteMany({ where: { id: postId } }).catch(() => undefined);
    }
    if (priorCard) {
      await signInAdmin(page.request).catch(() => undefined);
      await page.request.patch("/api/admin/payment-channels/card", {
        headers: authHeaders,
        data: {
          enabled: priorCard.enabled,
          mode: priorCard.mode,
          currencies: priorCard.currencies,
          regions: priorCard.regions,
          feeNote: priorCard.feeNote,
          statusNote: priorCard.statusNote,
          config: priorCard.config
        }
      }).catch(() => undefined);
    }
  }
});

async function openPostHeroViewer(page: Page) {
  const viewer = page.getByRole("dialog", { name: "媒体预览" });
  await expect(async () => {
    await page.getByTestId("post-hero-media").click();
    await expect(viewer).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  return viewer;
}

test("post hero and gallery open the shared top-level image viewer", async ({ page }) => {
  await page.goto("/post/post-1");

  const viewer = await openPostHeroViewer(page);
  await expect(viewer.getByRole("button", { name: "全屏预览" })).toBeVisible();

  await viewer.getByRole("button", { name: "关闭媒体预览" }).click();
  await page.getByRole("button", { name: "查看图片 2" }).click();
  await expect(page.getByText("2 / 12", { exact: true })).toBeVisible();
});

test("homepage post cards open the shared top-level image viewer", async ({ page }) => {
  await page.goto("/");
  const viewer = page.getByRole("dialog", { name: "媒体预览" });
  await expect(async () => {
    await page.locator('[data-post-id="post-1"]').getByRole("button", { name: "查看图片 1" }).click();
    await expect(viewer).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await expect(viewer.getByRole("button", { name: "全屏预览" })).toBeVisible();
});

test("search thumbnail preview opens the shared viewer without navigating", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Search preview requires the seeded PostgreSQL database.");
  await page.goto("/search?q=Cosplay&type=post");

  const result = page.getByTestId("search-result").filter({
    has: page.getByTestId("search-result-preview")
  }).first();
  const preview = result.getByTestId("search-result-preview");
  const title = result.getByTestId("search-result-title");
  const summary = result.getByTestId("search-result-summary");
  await expect(title).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(summary).toBeVisible();
  expect(await result.evaluate((node) => {
    const titleLink = node.querySelector('[data-testid="search-result-title"]');
    const previewButton = node.querySelector('[data-testid="search-result-preview"]');
    const summaryText = node.querySelector('[data-testid="search-result-summary"]');
    return Boolean(
      titleLink
      && previewButton
      && summaryText
      && (titleLink.compareDocumentPosition(previewButton) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (previewButton.compareDocumentPosition(summaryText) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  })).toBeTruthy();

  const urlBeforePreview = page.url();
  await preview.click();
  await expect(page.getByRole("dialog", { name: "\u5a92\u4f53\u9884\u89c8" })).toBeVisible();
  await expect(page).toHaveURL(urlBeforePreview);

  const href = await title.getAttribute("href");
  expect(href).toMatch(/^\/post\//);
  await page.getByRole("dialog", { name: "\u5a92\u4f53\u9884\u89c8" }).getByRole("button", { name: "\u5173\u95ed\u5a92\u4f53\u9884\u89c8" }).click();
  await title.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test("post detail uses the authoritative repository media payload", async ({ page }) => {
  await page.route("**/api/posts/post-1", async (route) => {
    await route.fulfill({ json: {
      post: {
        id: "post-1",
        creatorId: "c1",
        title: "Repository video post",
        excerpt: "The repository response supplies the playable media.",
        content: "Repository content.",
        cover: "cover-1",
        category: "Cosplay",
        tags: ["Cosplay"],
        visibility: "free",
        likes: 0,
        comments: [],
        createdAt: "刚刚",
        hasAccess: true,
        media: [{
          id: "repository-video-1",
          src: "/generated/posts/post-1/01.webp",
          alt: "Repository video media",
          width: 720,
          height: 900,
          order: 1,
          kind: "video"
        }]
      }
    } });
  });

  await page.goto("/post/post-1");
  await expect(page.getByRole("heading", { name: "Repository video post" })).toBeVisible();
  await expect(page.getByTestId("post-hero-media").getByLabel("Repository video media")).toBeVisible();
  await openPostHeroViewer(page);
  await expect(page.getByRole("dialog", { name: "媒体预览" }).getByLabel("Repository video media")).toHaveJSProperty("controls", true);
});

test("media viewer traps Tab focus", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mobile emulation does not advance focus with a virtual Tab key; desktop verifies focus containment.");
  await page.goto("/post/post-1");
  const viewer = await openPostHeroViewer(page);
  const close = viewer.getByRole("button", { name: "关闭媒体预览" });
  const fullscreen = viewer.getByRole("button", { name: "全屏预览" });
  const previous = viewer.getByRole("button", { name: "上一张" });
  const next = viewer.getByRole("button", { name: "下一张" });

  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(fullscreen).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(previous).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(next).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(next).toBeFocused();
});

test("locked purchase and membership media open unlock UI without exposing the viewer", async ({ page }) => {
  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/posts/post-4"),
    page.goto("/post/post-4")
  ]);
  const purchaseGallery = page.getByTestId("post-detail-gallery");
  await purchaseGallery.getByRole("button", { name: "查看图片 2" }).click();
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭媒体预览" }).click();
  await purchaseGallery.getByRole("button", { name: "解锁图片 3" }).click();
  await expect(page.getByRole("dialog", { name: "解锁作品" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "媒体预览" })).toHaveCount(0);

  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/posts/post-3"),
    page.goto("/post/post-3")
  ]);
  const membershipGallery = page.getByTestId("post-detail-gallery");
  await membershipGallery.getByRole("button", { name: "解锁图片 3" }).click();
  const unlockDialog = page.getByRole("dialog", { name: "解锁作品" });
  await expect(unlockDialog).toBeVisible();
  await expect(unlockDialog.getByRole("link", { name: "登录后查看会员方案" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "媒体预览" })).toHaveCount(0);
});

async function seedVideoFixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("purehub-demo-state", JSON.stringify({
      state: {
        role: "fan",
        theme: "light",
        liked: [],
        bookmarked: [],
        followed: [],
        subscriptions: [],
        unlocked: [],
        customPosts: [{
          id: "video-fixture",
          creatorId: "c1",
          title: "Video preview fixture",
          excerpt: "A synthetic video media asset for viewer coverage.",
          content: "Video fixture content.",
          cover: "cover-1",
          category: "Cosplay",
          tags: ["Cosplay"],
          visibility: "free",
          likes: 0,
          comments: [],
          createdAt: "刚刚",
          media: [{
            id: "video-fixture-media-1",
            src: "/generated/posts/post-1/01.webp",
            alt: "Synthetic video preview",
            width: 720,
            height: 900,
            order: 1,
            kind: "video"
          }]
        }],
        transactions: [],
        balance: 0
      },
      version: 2
    }));
  });
}

test("video viewer renders controlled media without autoplay", async ({ page }) => {
  await seedVideoFixture(page);
  await page.goto("/post/video-fixture");
  await openPostHeroViewer(page);

  const video = page.getByRole("dialog", { name: "媒体预览" }).getByLabel("Synthetic video preview");
  await expect(video).toBeVisible();
  await expect(video).toHaveJSProperty("autoplay", false);
  await expect(video).toHaveJSProperty("controls", true);
  await expect(video).toHaveJSProperty("muted", false);
});

test("fullscreen preview keeps every viewer control on the fullscreen surface and exits", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Fullscreen API behavior is verified in the desktop browser; mobile emulation does not expose a stable API surface.");
  await page.addInitScript(() => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement
    });
    HTMLElement.prototype.requestFullscreen = function requestFullscreen() {
      Reflect.set(window, "__purehubFullscreenRequests", Number(Reflect.get(window, "__purehubFullscreenRequests") ?? 0) + 1);
      Reflect.set(window, "__purehubFullscreenTarget", this);
      fullscreenElement = Reflect.get(window, "__purehubFullscreenTarget") as Element;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    Document.prototype.exitFullscreen = function exitFullscreen() {
      Reflect.set(window, "__purehubFullscreenExits", Number(Reflect.get(window, "__purehubFullscreenExits") ?? 0) + 1);
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
  });
  await page.goto("/post/post-1");
  const viewer = await openPostHeroViewer(page);
  await page.getByRole("button", { name: "全屏预览" }).click();
  await expect.poll(() => page.evaluate(() => Number(Reflect.get(window, "__purehubFullscreenRequests") ?? 0))).toBe(1);
  await expect(viewer.getByRole("button", { name: "退出全屏" })).toBeVisible();
  expect(await page.evaluate(() => {
    const target = Reflect.get(window, "__purehubFullscreenTarget") as HTMLElement | undefined;
    return Boolean(
      target
      && target.contains(document.querySelector('[aria-label="关闭媒体预览"]'))
      && target.contains(document.querySelector('[aria-label="退出全屏"]'))
      && target.contains(document.querySelector('[aria-label="上一张"]'))
      && target.contains(document.querySelector('[aria-label="下一张"]'))
      && target.textContent?.includes("1 / 12")
    );
  })).toBe(true);
  await viewer.getByRole("button", { name: "退出全屏" }).click();
  await expect.poll(() => page.evaluate(() => Number(Reflect.get(window, "__purehubFullscreenExits") ?? 0))).toBe(1);
  await expect(viewer.getByRole("button", { name: "全屏预览" })).toBeVisible();
});

test("fullscreen preview stays open when the API is unavailable", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Fullscreen API behavior is verified in the desktop browser; mobile emulation does not expose a stable API surface.");
  await page.goto("/post/post-1");
  await openPostHeroViewer(page);
  await page.evaluate(() => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: undefined });
  });
  await page.getByRole("button", { name: "全屏预览" }).click();
  await expect(page.getByRole("dialog", { name: "媒体预览" })).toBeVisible();
});
