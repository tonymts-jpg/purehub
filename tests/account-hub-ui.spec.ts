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
    await expect(page.getByRole("main").getByRole("link", { name: "成为博主" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "账户", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "收藏", exact: true })).toBeVisible();
});

test("navigation: mobile bottom stays compact with My", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only navigation coverage.");
  await page.goto("/");

  const mobileNavigation = page.getByRole("navigation", { name: "移动导航" });
  await expect(mobileNavigation.getByRole("link", { name: "我的" })).toBeVisible();
  await expect(mobileNavigation.getByRole("link", { name: "成为博主" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "成为博主" })).toBeVisible();
});

test("legacy library redirects to favorites", async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  await page.context().addCookies([{ name: "purehub.session_token", value: "legacy-library-redirect", url: baseURL }]);
  await page.goto("/library");
  await expect(page).toHaveURL(/\/favorites$/);
});

test("sign-in never navigates to an external or backslash callback", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      token: "safe-callback-test",
      user: { id: "safe-callback-user", name: "Safe Callback", email: "safe@example.test" }
    })
  }));

  for (const callback of ["//evil.example/steal", "/%5cevil.example/steal"]) {
    await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(callback)}`);
    await page.locator('input[type="email"]').fill("safe@example.test");
    await page.locator('input[type="password"]').fill("safe-callback-password");
    await page.locator("form button").click();
    await expect(page).toHaveURL(/\/$/);
    expect(new URL(page.url()).origin).toBe(new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001").origin);
  }
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
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      items: [{ post: accountPost("post-2", "第二页收藏"), creator: accountCreator(), occurredAt: "2026-07-29T00:00:00.000Z" }],
      nextCursor: null
    }) });
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
        { post: accountPost("post-1", "一次购买作品"), creator: accountCreator(), source: "purchase", occurredAt: "2026-07-30T00:00:00.000Z" },
        { post: accountPost("post-2", "订阅作品"), creator: accountCreator(), source: "subscription", occurredAt: "2026-07-29T00:00:00.000Z" }
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

function followingCreator() {
  return {
    id: "creator-1",
    name: "测试创作者",
    handle: "creator-one",
    avatar: "测",
    bio: "用于验证关注列表的简介。",
    category: "Photography",
    verified: true,
    following: true
  };
}

function buyerOrder(status = "paid") {
  return {
    id: "order-1001",
    kind: "post_unlock",
    itemId: "post-1",
    itemLabel: "订单作品",
    amount: 1990,
    currency: "CNY",
    status,
    provider: "微信支付",
    createdAt: "2026-07-30T04:00:00.000Z",
    paidAt: "2026-07-30T04:01:00.000Z",
    creator: { id: "creator-1", name: "测试创作者", handle: "creator-one", avatar: "测" }
  };
}

test("likes: keeps a liked post until the canonical unlike response succeeds", async ({ page }) => {
  await mockAccountSession(page);
  let releaseUnlike: (() => void) | undefined;
  const unlikePending = new Promise<void>((resolve) => { releaseUnlike = resolve; });
  await page.route("**/api/me/likes**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [{ post: { ...accountPost("post-liked", "已喜欢作品"), liked: true }, occurredAt: "2026-07-30T04:00:00.000Z" }], nextCursor: null })
  }));
  await page.route("**/api/posts/post-liked/like", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    await unlikePending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ liked: false }) });
  });

  await page.goto("/likes");
  await expect(page.getByTestId("post-card")).toHaveCount(1);
  await page.getByRole("button", { name: "喜欢" }).click();
  await expect(page.getByTestId("post-card")).toHaveCount(1);
  releaseUnlike?.();
  await expect(page.getByTestId("post-card")).toHaveCount(0);
});

test("likes: failed unlike retains the already loaded item and exposes a retryable error", async ({ page }) => {
  await mockAccountSession(page);
  await page.route("**/api/me/likes**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [{ post: { ...accountPost("post-like-failure", "喜欢失败仍保留"), liked: true }, occurredAt: "2026-07-30T04:00:00.000Z" }], nextCursor: null })
  }));
  await page.route("**/api/posts/post-like-failure/like", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "操作失败" }) }));

  await page.goto("/likes");
  await page.getByRole("button", { name: "喜欢" }).click();
  await expect(page.getByTestId("post-card")).toHaveCount(1);
  await expect(page.getByText("操作失败", { exact: false })).toBeVisible();
});

test("following: removes a creator only after canonical unfollow succeeds", async ({ page }) => {
  await mockAccountSession(page);
  let releaseUnfollow: (() => void) | undefined;
  const unfollowPending = new Promise<void>((resolve) => { releaseUnfollow = resolve; });
  await page.route("**/api/me/following**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [{ creator: followingCreator(), occurredAt: "2026-07-30T04:00:00.000Z" }], nextCursor: null })
  }));
  await page.route("**/api/creators/creator-one/follow", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    await unfollowPending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ following: false }) });
  });

  await page.goto("/following");
  await expect(page.getByTestId("following-card")).toHaveCount(1);
  await page.getByRole("button", { name: "取消关注" }).click();
  await expect(page.getByTestId("following-card")).toHaveCount(1);
  releaseUnfollow?.();
  await expect(page.getByTestId("following-card")).toHaveCount(0);
});

test("history: renders API last-viewed time and never records a view", async ({ page }) => {
  await mockAccountSession(page);
  let recordedViews = 0;
  await page.route("**/api/me/history**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [{ post: accountPost("post-history", "浏览历史作品"), occurredAt: "2026-07-30T04:05:00.000Z" }], nextCursor: null })
  }));
  await page.route("**/api/posts/*/view", (route) => {
    recordedViews += 1;
    return route.fulfill({ status: 500 });
  });

  await page.goto("/history");
  await expect(page.getByTestId("history-item")).toHaveCount(1);
  await expect(page.getByTestId("history-last-viewed")).toContainText("2026");
  await expect(page.getByTestId("history-item").getByRole("link")).toHaveAttribute("href", "/post/post-history");
  expect(recordedViews).toBe(0);
});

test("orders: renders only approved fields and switches from a desktop table to mobile cards", async ({ page }, testInfo: TestInfo) => {
  await mockAccountSession(page);
  await page.route("**/api/me/orders**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [{ ...buyerOrder(), clientSecret: "must-not-render", manualInstructions: "must-not-render" }],
      nextCursor: null
    })
  }));

  await page.goto("/orders");
  await expect(page.getByText(/clientSecret|manualInstructions/)).toHaveCount(0);
  if (testInfo.project.name === "mobile") {
    await expect(page.getByTestId("order-history-cards")).toBeVisible();
    await expect(page.getByTestId("order-history-table")).toBeHidden();
    await expect(page.getByTestId("order-history-cards").getByText("已支付", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByTestId("order-history-table")).toBeVisible();
    await expect(page.getByTestId("order-history-cards")).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "订单编号" })).toBeVisible();
    await expect(page.getByTestId("order-history-table").getByText("已支付", { exact: true })).toBeVisible();
  }
});
function accountCreator(id = "creator-1") {
  return { id, name: "数据库创作者", handle: "database-creator", avatar: "数" };
}

test("likes: loading, empty, initial error retry, pagination retry, and stale pagination keep rows", async ({ page }) => {
  await mockAccountSession(page);
  let requestCount = 0;
  let releaseInitial: (() => void) | undefined;
  const initialPending = new Promise<void>((resolve) => { releaseInitial = resolve; });
  const cursors: Array<string | null> = [];
  await page.route("**/api/me/likes**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    requestCount += 1;
    if (requestCount === 1) {
      await initialPending;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) });
    }
    if (requestCount === 2) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "首次加载失败" }) });
    if (requestCount === 3) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ post: { ...accountPost("liked-first", "第一页喜欢"), liked: true }, creator: accountCreator(), occurredAt: "2026-07-30T04:00:00.000Z" }], nextCursor: "page-two" }) });
    if (requestCount === 4) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "更多加载失败" }) });
    if (requestCount === 5) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ post: { ...accountPost("liked-second", "第二页喜欢"), liked: true }, creator: accountCreator("creator-2"), occurredAt: "2026-07-29T04:00:00.000Z" }], nextCursor: "page-three" }) });
    return route.fulfill({ status: 401, contentType: "text/plain", body: "expired" });
  });

  await page.goto("/likes?from=account");
  await expect(page.getByRole("status")).toBeVisible();
  releaseInitial?.();
  await expect(page.getByText("还没有喜欢的作品")).toBeVisible();
  await page.reload();
  await expect(page.getByText("首次加载失败", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByTestId("post-card")).toHaveCount(1);
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByText("更多加载失败", { exact: false })).toBeVisible();
  await expect(page.getByTestId("post-card")).toHaveCount(1);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByTestId("post-card")).toHaveCount(2);
  expect(cursors).toEqual([null, null, null, "page-two", "page-two"]);
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Flikes%3Ffrom%3Daccount/);
});

test("orders: failed pagination retry repeats its cursor and preserves appended rows", async ({ page }) => {
  await mockAccountSession(page);
  const cursors: Array<string | null> = [];
  let requestCount = 0;
  await page.route("**/api/me/orders**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    requestCount += 1;
    if (requestCount === 1) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [buyerOrder()], nextCursor: "orders-two" }) });
    if (requestCount === 2) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "订单分页失败" }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ ...buyerOrder(), id: "order-1002", itemLabel: "第二页订单" }], nextCursor: null }) });
  });

  await page.goto("/orders");
  await expect(page.getByTestId("order-history-table").getByText("订单作品")).toHaveCount(1);
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByText("订单分页失败", { exact: false })).toBeVisible();
  await expect(page.getByTestId("order-history-table").getByText("订单作品")).toHaveCount(1);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByTestId("order-history-table").getByText("第二页订单")).toHaveCount(1);
  expect(cursors).toEqual([null, "orders-two", "orders-two"]);
});

test("following: failed unfollow retains the creator and exposes retryable failure", async ({ page }) => {
  await mockAccountSession(page);
  await page.route("**/api/me/following**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ creator: followingCreator(), occurredAt: "2026-07-30T04:00:00.000Z" }], nextCursor: null }) }));
  await page.route("**/api/creators/creator-one/follow", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "取消关注失败" }) }));

  await page.goto("/following");
  await page.getByRole("button", { name: "取消关注" }).click();
  await expect(page.getByTestId("following-card")).toHaveCount(1);
  await expect(page.getByText("取消关注失败", { exact: false })).toBeVisible();
});

test("likes: serializes a pending unlike so no stale second mutation can remove the item", async ({ page }) => {
  await mockAccountSession(page);
  let requestCount = 0;
  let releaseUnlike: (() => void) | undefined;
  const unlikePending = new Promise<void>((resolve) => { releaseUnlike = resolve; });
  await page.route("**/api/me/likes**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ post: { ...accountPost("liked-serial", "串行喜欢"), liked: true }, creator: accountCreator(), occurredAt: "2026-07-30T04:00:00.000Z" }], nextCursor: null }) }));
  await page.route("**/api/posts/liked-serial/like", async (route) => {
    requestCount += 1;
    await unlikePending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ liked: false }) });
  });

  await page.goto("/likes");
  const likeButton = page.getByRole("button", { name: "喜欢" });
  await likeButton.click();
  await expect(likeButton).toBeDisabled();
  await likeButton.click({ force: true });
  expect(requestCount).toBe(1);
  releaseUnlike?.();
  await expect(page.getByTestId("post-card")).toHaveCount(0);
});

test("history: renders the canonical API creator instead of the demo catalog", async ({ page }) => {
  await mockAccountSession(page);
  await page.route("**/api/me/history**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ post: accountPost("history-db-creator", "数据库历史"), creator: accountCreator("database-creator"), occurredAt: "2026-07-30T04:05:00.000Z" }], nextCursor: null }) }));

  await page.goto("/history");
  await expect(page.getByText("数据库创作者", { exact: true })).toBeVisible();
});

test("favorites and unlocked render the canonical API creator instead of demo identity", async ({ page }) => {
  await mockAccountSession(page);
  const creator = accountCreator("database-account-creator");
  await page.route("**/api/me/favorites**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [{ post: accountPost("favorite-db-creator", "数据库收藏"), creator, occurredAt: "2026-07-30T04:00:00.000Z" }],
      nextCursor: null
    })
  }));
  await page.route("**/api/me/unlocked**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [{ post: accountPost("unlocked-db-creator", "数据库解锁"), creator, source: "purchase", occurredAt: "2026-07-30T03:00:00.000Z" }],
      nextCursor: null
    })
  }));

  await page.goto("/favorites");
  await expect(page.getByText("数据库创作者", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "数据库创作者" })).toHaveAttribute("href", "/creator/database-creator");

  await page.goto("/unlocked");
  await expect(page.getByText("数据库创作者", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "数据库创作者" })).toHaveAttribute("href", "/creator/database-creator");
  await expect(page.getByText("Single Purchase")).toBeVisible();
});

test("hot posts: home rail renders four canonical posts before creators", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The home right rail is desktop-only.");
  await page.setViewportSize({ width: 1600, height: 900 });
  const posts = Array.from({ length: 5 }, (_, index) => ({
    id: `hot-post-${index + 1}`,
    creatorId: `hot-creator-${index + 1}`,
    title: `热度作品 ${index + 1}`,
    excerpt: `热度作品 ${index + 1} 摘要`,
    content: `热度作品 ${index + 1} 正文`,
    cover: "from-violet to-coral",
    category: "摄影",
    tags: [],
    visibility: "free",
    likes: 120 - index,
    comments: [],
    createdAt: "刚刚",
    media: [{
      id: `hot-media-${index + 1}`,
      src: `/api/media/hot-media-${index + 1}/content`,
      alt: `热度作品 ${index + 1} 缩略图`,
      width: 640,
      height: 480,
      order: 0,
      kind: "image"
    }],
    popularityScore: 200 - index,
    creator: {
      id: `hot-creator-${index + 1}`,
      name: `热度博主 ${index + 1}`,
      handle: `hot-creator-${index + 1}`,
      avatar: "热"
    }
  }));
  await page.route("**/api/trending/posts?limit=4", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ posts })
  }));

  await page.goto("/");

  const hotPosts = page.getByTestId("hot-posts");
  const hotCreators = page.getByTestId("hot-creators");
  await expect(hotPosts.getByTestId("hot-post-item")).toHaveCount(4);
  await expect(hotCreators).toBeVisible();
  await expect(hotPosts.getByRole("img", { name: "热度作品 1 缩略图" })).toBeVisible();
  await expect(hotPosts.getByRole("link", { name: "热度作品 1", exact: true })).toHaveAttribute("href", "/post/hot-post-1");
  await expect(hotPosts.getByText("热度博主 1", { exact: true })).toBeVisible();
  await expect(hotPosts.getByText("120", { exact: true })).toBeVisible();
  expect(await hotPosts.evaluate((node) => node.compareDocumentPosition(
    document.querySelector('[data-testid="hot-creators"]')!
  ) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(hotPosts.getByRole("link", { name: "查看全部熱度作品" })).toHaveAttribute(
    "href", "/trending/posts"
  );
});
