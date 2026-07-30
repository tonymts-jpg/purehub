import { expect, test } from "@playwright/test";
import { adminNavigationForPermissions } from "../components/admin/admin-nav";
import { canAdminAccess, canAdminManageSettings } from "../lib/admin-auth";
import { hasDatabase, signInSupport } from "./auth-helpers";

test("admin authorization distinguishes domain read and write access", () => {
  expect(canAdminAccess("support_admin", "members", "read")).toBe(true);
  expect(canAdminAccess("support_admin", "members", "write")).toBe(false);
  expect(canAdminAccess("finance_admin", "finance", "write")).toBe(true);
  expect(canAdminAccess("analyst", "audit", "read")).toBe(true);
  expect(canAdminAccess("analyst", "audit", "write")).toBe(false);
});

test("admin authorization keeps settings mutations within their owning roles", () => {
  expect(canAdminAccess("ops_admin", "settings", "write")).toBe(true);
  expect(canAdminAccess("finance_admin", "settings", "write")).toBe(true);
  expect(canAdminAccess("content_admin", "settings", "read")).toBe(false);
  expect(canAdminAccess("support_admin", "channels", "read")).toBe(false);
  expect(canAdminManageSettings("finance_admin", "finance")).toBe(true);
  expect(canAdminManageSettings("finance_admin", "operations")).toBe(false);
  expect(canAdminManageSettings("ops_admin", "finance")).toBe(false);
  expect(canAdminManageSettings("ops_admin", "operations")).toBe(true);
  expect(canAdminManageSettings("super_admin", "finance")).toBe(true);
  expect(canAdminManageSettings("super_admin", "operations")).toBe(true);
});

test("admin authorization filters navigation as presentation only", () => {
  expect(adminNavigationForPermissions(["overview", "members", "creators"]).map((item) => item.section)).toEqual([
    "overview",
    "members",
    "creators"
  ]);
  expect(adminNavigationForPermissions(["overview", "audit"]).map((item) => item.href)).toEqual([
    "/admin",
    "/admin/audit"
  ]);
});

test("admin sign-in is public and separate from the protected admin shell", async ({ page }) => {
  await page.goto("/admin/sign-in");

  await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  await expect(page.getByTestId("site-shell")).toHaveCount(0);
});

test("admin authorization redirects protected routes to the fixed admin sign-in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL("/admin/sign-in");

  await page.goto("/admin/members?callbackUrl=https://evil.example");
  await expect(page).toHaveURL("/admin/sign-in");
});

test("public pages do not expose an admin sign-in link", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: /Admin|管理后台|站务后台/i })).toHaveCount(0);
});

test("admin authorization ignores x-admin-role and enforces direct API writes", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Admin role enforcement requires seeded administrator accounts.");
  await signInSupport(request);

  const readable = await request.get("/api/admin/users", {
    headers: { "x-admin-role": "super_admin" }
  });
  expect(readable.status()).toBe(200);

  const forbidden = await request.patch("/api/admin/users/user-demo", {
    headers: { "x-admin-role": "super_admin" },
    data: { status: "suspended" }
  });
  expect(forbidden.status()).toBe(403);
});
