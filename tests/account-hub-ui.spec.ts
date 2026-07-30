import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { hasDatabase, signInCreator, signInFan } from "./auth-helpers";

async function signInCreatorPage(page: Page) {
  await signInCreator(page.request);
}

async function useCreatorApplicantSession(page: Page, creatorStatus: "pending" | "rejected") {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  await page.context().addCookies([{
    name: "purehub.session_token",
    value: "account-hub-pending-creator",
    url: baseURL
  }]);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: `${creatorStatus}-creator-session`, userId: `${creatorStatus}-creator`, expiresAt: "2027-07-30T00:00:00.000Z" },
      user: {
        id: `${creatorStatus}-creator`,
        name: `${creatorStatus} Creator`,
        email: `${creatorStatus}-creator@purehub.local`,
        role: "creator",
        creatorStatus,
        status: "active"
      }
    })
  }));
}

const usePendingCreatorSession = (page: Page) => useCreatorApplicantSession(page, "pending");

async function useApprovedCreatorSession(page: Page) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  await page.context().addCookies([{
    name: "purehub.session_token",
    value: "account-hub-approved-creator",
    url: baseURL
  }]);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "approved-creator-session", userId: "approved-creator", expiresAt: "2027-07-30T00:00:00.000Z" },
      user: {
        id: "approved-creator",
        name: "Approved Creator",
        email: "approved-creator@purehub.local",
        role: "creator",
        creatorStatus: "approved",
        status: "active"
      }
    })
  }));
}

test("navigation: guest sees public navigation only", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop navigation groups are hidden on mobile.");
  await page.goto("/");

  await expect(page.getByRole("link", { name: "成为博主" })).toBeVisible();
  await expect(page.getByRole("link", { name: "收藏", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "通知", exact: true })).toHaveCount(0);
  await expect(page.getByText("账户", { exact: true })).toHaveCount(0);
});

test("navigation: fan gets the complete account navigation", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mobile account navigation lives under My.");
  test.skip(!(await hasDatabase(page.request)), "Authenticated navigation requires the seeded PostgreSQL database.");
  await signInFan(page.request);
  await page.goto("/");

  await expect(page.getByText("账户", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "收藏", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "订单", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "成为博主" })).toBeVisible();
  await expect(page.getByText("博主空间", { exact: true })).toHaveCount(0);
});

test("navigation: approved creator gets fan links and creator space without become creator", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mobile account navigation lives under My.");
  test.skip(!(await hasDatabase(page.request)), "Authenticated navigation requires the seeded PostgreSQL database.");
  await signInCreatorPage(page);
  await page.goto("/");

  await expect(page.getByRole("link", { name: "收藏", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "订单", exact: true })).toBeVisible();
  await expect(page.getByText("博主空间", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "成为博主" })).toHaveCount(0);
});

test("navigation: pending creator keeps the application link and receives account links", async ({ page }, testInfo: TestInfo) => {
  await usePendingCreatorSession(page);
  await page.goto("/");

  if (testInfo.project.name === "mobile") {
    await expect(page.getByRole("link", { name: "我的" })).toHaveAttribute("href", "/me");
    await page.goto("/me");
    await expect(page.getByRole("link", { name: "收藏", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "成为博主" })).toBeVisible();
    await expect(page.getByText("博主空间", { exact: true })).toHaveCount(0);
    return;
  }

  await expect(page.getByRole("link", { name: "收藏", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "成为博主" })).toBeVisible();
  await expect(page.getByText("博主空间", { exact: true })).toHaveCount(0);
});

test("navigation: rejected creator keeps account links and the application entry", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop navigation groups are hidden on mobile.");
  await useCreatorApplicantSession(page, "rejected");
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "账户" })).toBeVisible();
  await expect(page.getByRole("link", { name: "收藏", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "成为博主" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "博主空间" })).toHaveCount(0);
});

test("navigation: desktop groups have distinct accessible names", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop navigation groups are hidden on mobile.");
  await useApprovedCreatorSession(page);
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "公共导航" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "账户" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "博主空间" })).toBeVisible();
});

test("navigation: only the current creator item is active", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop navigation groups are hidden on mobile.");
  await useApprovedCreatorSession(page);
  await page.goto("/dashboard/posts");

  const creatorNavigation = page.getByRole("navigation", { name: "博主空间" });
  await expect(creatorNavigation.locator("a[class*='bg-gradient-to-r']")).toHaveCount(1);
  await expect(creatorNavigation.getByRole("link", { name: "作品管理" })).toHaveClass(/bg-gradient-to-r/);
  await expect(creatorNavigation.getByRole("link", { name: "博主工作台" })).not.toHaveClass(/bg-gradient-to-r/);
});

test("navigation: mobile My opens the complete account menu", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only navigation coverage.");
  test.skip(!(await hasDatabase(page.request)), "Authenticated navigation requires the seeded PostgreSQL database.");
  await signInFan(page.request);
  await page.goto("/");

  await expect(page.getByRole("link", { name: "我的" })).toHaveAttribute("href", "/me");
  await page.goto("/me");
  await expect(page.getByText("账户", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "收藏", exact: true })).toBeVisible();
});

test("navigation: mobile bottom stays compact with My", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only navigation coverage.");
  await page.goto("/");

  await expect(page.getByRole("link", { name: "我的" })).toBeVisible();
  await expect(page.getByRole("link", { name: "成为博主" })).toHaveCount(0);
});

test("legacy library redirects to favorites", async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  await page.context().addCookies([{ name: "purehub.session_token", value: "legacy-library-redirect", url: baseURL }]);
  await page.goto("/library");
  await expect(page).toHaveURL(/\/favorites$/);
});

function accountPost(id: string, title: string) {
  return {
    id,
    creatorId: "c1",
    title,
    excerpt: "用于验证账户列表的确定性作品夹具。",
    content: "用于验证账户列表的确定性作品夹具。",
    cover: "cover-1",
    category: "Cosplay",
    tags: ["Cosplay"],
    visibility: "free",
    likes: 12,
    comments: [],
    createdAt: "今天",
    media: [],
    bookmarked: true,
    liked: false,
    hasAccess: true
  };
}

function favoriteChannel() {
  return {
    id: "channel-purehub-official",
    slug: "purehub-official",
    name: "PureHub 官方频道",
    description: "平台精选的公开频道。",
    kind: "official",
    visibility: "public",
    discoverability: "discoverable",
    status: "active",
    bookmarked: true,
    owner: { id: "admin-demo", name: "PureHub", handle: "purehub", avatar: "P" }
  };
}

async function mockAccountSession(page: Page) {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "account-hub-ui-session", userId: "fan", expiresAt: "2027-07-30T00:00:00.000Z" },
      user: { id: "fan", name: "Fan", email: "fan@purehub.local", role: "fan", status: "active" }
    })
  }));
}

test("favorites: channel tab removes a favorite only after its delete succeeds", async ({ page }) => {
  await mockAccountSession(page);
  await page.route("**/api/me/favorites**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [{ channel: favoriteChannel(), occurredAt: "2026-07-30T04:00:00.000Z" }],
      nextCursor: null
    })
  }));
  await page.route("**/api/channels/purehub-official/bookmark", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ bookmarked: false }) });
  });

  await page.goto("/favorites?type=channels");
  await expect(page.getByRole("tab", { name: "频道" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("channel-favorite-card")).toBeVisible();
  await page.getByRole("button", { name: "取消收藏频道" }).click();
  await expect(page.getByTestId("channel-favorite-card")).toHaveCount(0);
});

test("favorites: loading, empty, retryable failure, and load more preserve the account list contract", async ({ page }) => {
  await mockAccountSession(page);
  let requestCount = 0;
  let releaseFirstRequest: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => { releaseFirstRequest = resolve; });
  await page.route("**/api/me/favorites**", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await firstRequest;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) });
    }
    if (requestCount === 2) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "暂时无法加载收藏。" }) });
    }
    if (requestCount === 3) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: "page-2" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [accountPost("post-2", "第二页收藏")], nextCursor: null }) });
  });

  await page.goto("/favorites");
  await expect(page.getByRole("status")).toContainText("正在加载");
  releaseFirstRequest?.();
  await expect(page.getByText("还没有收藏内容")).toBeVisible();

  await page.reload();
  await expect(page.getByText("暂时无法加载收藏。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("还没有收藏内容")).toBeVisible();
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByTestId("post-card")).toHaveCount(1);
});

test("unlocked: renders the API-authoritative purchase and subscription labels", async ({ page }) => {
  await mockAccountSession(page);
  await page.route("**/api/me/unlocked**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [
        { post: accountPost("post-1", "一次购买作品"), source: "purchase", occurredAt: "2026-07-30T00:00:00.000Z" },
        { post: accountPost("post-2", "订阅作品"), source: "subscription", occurredAt: "2026-07-29T00:00:00.000Z" }
      ],
      nextCursor: null
    })
  }));

  await page.goto("/unlocked");
  await expect(page.getByText("Single Purchase")).toBeVisible();
  await expect(page.getByText("Active Subscription")).toBeVisible();
});

test("favorites: channel favorite public detail keeps the bookmark action separate and sends a guest to a safe return URL", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Channel detail is server-rendered and requires the seeded PostgreSQL database.");

  await page.goto("/channels/purehub-official?from=favorites");
  await expect(page.getByRole("button", { name: "收藏频道" })).toBeVisible();
  await expect(page.getByRole("button", { name: "申请加入频道" })).toHaveCount(0);
  await page.getByRole("button", { name: "收藏频道" }).click();
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fchannels%2Fpurehub-official%3Ffrom%3Dfavorites/);
});

test("favorites: channel favorite visible private owner detail keeps bookmarking separate from membership", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Channel detail is server-rendered and requires the seeded PostgreSQL database.");
  await signInCreator(page.request, "chenmo");

  await page.goto("/channels/private-curators");
  await expect(page.getByRole("button", { name: "收藏频道" })).toBeVisible();
  await expect(page.getByText("频道所有者")).toBeVisible();
  await expect(page.getByRole("button", { name: /申请加入频道|退出频道/ })).toHaveCount(0);
});

test("favorites: stale session redirects before parsing a pagination response", async ({ page }) => {
  await mockAccountSession(page);
  await page.route("**/api/me/favorites**", (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      return route.fulfill({ status: 401, contentType: "text/plain", body: "expired" });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [{ channel: favoriteChannel(), occurredAt: "2026-07-30T04:00:00.000Z" }], nextCursor: "next-page" })
    });
  });

  await page.goto("/favorites?type=channels&from=search");
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Ffavorites%3Ftype%3Dchannels%26from%3Dsearch/);
});

test("favorites: stale session redirects before parsing a channel removal response", async ({ page }) => {
  await mockAccountSession(page);
  await page.route("**/api/me/favorites**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [{ channel: favoriteChannel(), occurredAt: "2026-07-30T04:00:00.000Z" }], nextCursor: null })
  }));
  await page.route("**/api/channels/purehub-official/bookmark", (route) => route.fulfill({ status: 401, contentType: "text/plain", body: "expired" }));

  await page.goto("/favorites?type=channels&from=detail");
  await page.getByRole("button", { name: "取消收藏频道" }).click();
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Ffavorites%3Ftype%3Dchannels%26from%3Ddetail/);
});

test("unlocked: stale session redirects before parsing a pagination response", async ({ page }) => {
  await mockAccountSession(page);
  await page.route("**/api/me/unlocked**", (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      return route.fulfill({ status: 401, contentType: "text/plain", body: "expired" });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [{ post: accountPost("post-1", "已解锁作品"), source: "purchase", occurredAt: "2026-07-30T00:00:00.000Z" }],
        nextCursor: "next-page"
      })
    });
  });

  await page.goto("/unlocked?from=library");
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Funlocked%3Ffrom%3Dlibrary/);
});

test("favorites: channel cards prioritize cover media, then avatar media, then a safe fallback", async ({ page }) => {
  await mockAccountSession(page);
  const privateChannel = {
    slug: "private-curators",
    name: "私密策展频道",
    description: "仅显示安全频道摘要。",
    kind: "creator",
    visibility: "private",
    discoverability: "discoverable",
    status: "active",
    bookmarked: true
  };
  await page.route("**/api/me/favorites**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [
        { channel: { ...favoriteChannel(), coverAssetId: "channel-cover", avatarAssetId: "channel-avatar", owner: { id: "owner", name: "频道所有者", handle: "owner", avatar: "O" } }, occurredAt: "2026-07-30T04:00:00.000Z" },
        { channel: { ...favoriteChannel(), slug: "avatar-only", name: "仅头像频道", coverAssetId: null, avatarAssetId: "channel-avatar-only" }, occurredAt: "2026-07-29T08:00:00.000Z" },
        { channel: privateChannel, occurredAt: "2026-07-29T04:00:00.000Z" }
      ],
      nextCursor: null
    })
  }));

  await page.goto("/favorites?type=channels");
  await expect(page.getByText("官方频道 · 公开频道", { exact: true })).toHaveCount(2);
  await expect(page.getByText("创作者频道 · 私密频道", { exact: true })).toBeVisible();
  await expect(page.getByTestId("channel-favorite-cover")).toHaveAttribute("src", "/api/media/channel-cover/content");
  await expect(page.getByTestId("channel-favorite-avatar")).toHaveAttribute("src", "/api/media/channel-avatar-only/content");
  await expect(page.getByTestId("channel-favorite-owner-avatar")).toHaveCount(0);
  await expect(page.getByTestId("channel-favorite-fallback")).toHaveText("私");
});

test("favorites: channel favorite detail redirects on a stale bookmark mutation", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Channel detail is server-rendered and requires the seeded PostgreSQL database.");
  await mockAccountSession(page);
  await page.route("**/api/channels/purehub-official/bookmark", (route) => route.fulfill({ status: 401, contentType: "text/plain", body: "expired" }));

  await page.goto("/channels/purehub-official?from=favorites");
  await page.getByRole("button", { name: "收藏频道" }).click();
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fchannels%2Fpurehub-official%3Ffrom%3Dfavorites/);
});

test("favorites: channel favorite detail defers interaction until session hydration completes", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Channel detail is server-rendered and requires the seeded PostgreSQL database.");
  let releaseSession: (() => void) | undefined;
  const sessionPending = new Promise<void>((resolve) => { releaseSession = resolve; });
  await page.route("**/api/auth/get-session", async (route) => {
    await sessionPending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ session: null, user: null }) });
  });

  await page.goto("/channels/purehub-official");
  await expect(page.getByRole("button", { name: "收藏频道" })).toBeDisabled();
  releaseSession?.();
  await expect(page.getByRole("button", { name: "收藏频道" })).toBeEnabled();
});
