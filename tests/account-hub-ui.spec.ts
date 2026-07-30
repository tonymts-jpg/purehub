import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { hasDatabase, signInCreator, signInFan } from "./auth-helpers";

async function signInCreatorPage(page: Page) {
  await signInCreator(page.request);
}

async function usePendingCreatorSession(page: Page) {
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
      session: { id: "pending-creator-session", userId: "pending-creator", expiresAt: "2027-07-30T00:00:00.000Z" },
      user: {
        id: "pending-creator",
        name: "Pending Creator",
        email: "pending-creator@purehub.local",
        role: "creator",
        creatorStatus: "pending",
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
