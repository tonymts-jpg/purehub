import { expect, test } from "@playwright/test";
import { adminNavigationForPermissions } from "../components/admin/admin-nav";
import { canAdminAccess, canAdminManageSettings } from "../lib/admin-auth";
import { getAdminOverview } from "../lib/admin-repository";
import { authHeaders, hasDatabase, signInAdmin, signInSupport } from "./auth-helpers";

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

test("admin overview returns counts and work queues without domain tables", async () => {
  const overview = await getAdminOverview();

  expect(Object.keys(overview).sort()).toEqual(["metrics", "queues"]);
  expect(overview.queues).toEqual({
    pendingApplications: 0,
    pendingContent: 0,
    pendingChannels: 0,
    pendingRefunds: 0,
    pendingPayouts: 0,
    reconciliationExceptions: 0
  });
  expect(overview).not.toHaveProperty("activePricingVersion");
  expect(overview).not.toHaveProperty("auditLogs");
});

test("admin overview work queue shortcuts use exact owning-domain filters", async () => {
  const { ADMIN_WORK_QUEUES } = await import("../components/admin/overview-page");

  expect(ADMIN_WORK_QUEUES.map(({ label, href }) => ({ label, href }))).toEqual([
    { label: "待审创作者", href: "/admin/creators?status=pending" },
    { label: "待审内容", href: "/admin/content?status=pending" },
    { label: "待审频道", href: "/admin/channels?status=pending" },
    { label: "待处理退款", href: "/admin/finance?tab=refunds&status=pending" },
    { label: "待处理提现", href: "/admin/finance?tab=payouts&status=pending" },
    { label: "对账异常", href: "/admin/finance?tab=reconciliation&status=exception" }
  ]);
});

test("admin members request isolation preserves exact URL filters", async () => {
  const calls: string[] = [];
  const { loadAdminMembers } = await import("../components/admin/members-page");
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ users: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await loadAdminMembers(new URLSearchParams("q=alice&role=creator&status=active"), fetcher);

  expect(calls).toEqual(["/api/admin/users?q=alice&role=creator&status=active"]);
  expect(calls.every((url) => /^\/api\/admin\/users(?:\?.*)?$/.test(url))).toBe(true);
});

test("admin creators request isolation loads only applications and levels", async () => {
  const calls: string[] = [];
  const { loadAdminCreators } = await import("../components/admin/creators-page");
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify(url.includes("creator-levels")
      ? { levels: [] }
      : { applications: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await loadAdminCreators(new URLSearchParams("status=pending&q=yuki"), fetcher);

  expect(calls).toEqual([
    "/api/admin/creator-applications?status=pending&q=yuki",
    "/api/admin/creator-levels"
  ]);
  expect(calls.every((url) => /^\/api\/admin\/(?:creator-applications(?:\?.*)?|creator-levels)$/.test(url))).toBe(true);
});

test("admin content request isolation uses only the strict content list API", async () => {
  const calls: string[] = [];
  const { loadAdminContent } = await import("../components/admin/content-page");
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ posts: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await loadAdminContent(new URLSearchParams("status=pending&q=photo&cursor=opaque"), fetcher);

  expect(calls).toEqual(["/api/admin/content?status=pending&q=photo&cursor=opaque"]);
  expect(calls.every((url) => /^\/api\/admin\/content(?:\?.*)?$/.test(url))).toBe(true);
});

test("admin channels initializes the exact approved status filter", async () => {
  const {
    adminChannelListUrl,
    canUseAdminChannelOperations
  } = await import("../components/channels/admin-channel-operations");

  expect(adminChannelListUrl("pending")).toBe("/api/admin/channels?status=pending");
  expect(adminChannelListUrl("all")).toBe("/api/admin/channels");
  expect(adminChannelListUrl("actorUserId=spoofed")).toBe("/api/admin/channels?status=pending");
  expect(/^\/api\/admin\/channels(?:\?.*)?$/.test(adminChannelListUrl("pending"))).toBe(true);
  expect(canUseAdminChannelOperations({ role: "content_admin", permissions: ["overview", "content", "channels"] })).toBe(true);
  expect(canUseAdminChannelOperations({ role: "support_admin", permissions: ["overview", "members", "creators"] })).toBe(false);
  expect(canUseAdminChannelOperations({ role: "finance_admin", permissions: ["overview", "finance"] })).toBe(false);
});

test("admin content moderation accepts only canonical list filters and actions", async () => {
  const {
    parseAdminContentAction,
    parseAdminContentListInput,
    resolveModeratedVisibility
  } = await import("../lib/admin-content-repository");

  expect(parseAdminContentListInput(new URL("http://purehub.local/api/admin/content?status=pending&q=photo&cursor=opaque").searchParams))
    .toEqual({ status: "pending", q: "photo", cursor: "opaque" });
  expect(() => parseAdminContentListInput(new URL("http://purehub.local/api/admin/content?actorUserId=spoofed").searchParams))
    .toThrow("Unsupported admin content query parameter.");
  expect(() => parseAdminContentListInput(new URL("http://purehub.local/api/admin/content?status=pending&status=hidden").searchParams))
    .toThrow("Admin content query parameter must be unique.");
  expect(parseAdminContentAction({ action: "hide" })).toEqual({ action: "hide" });
  expect(() => parseAdminContentAction({ action: "hide", actorUserId: "spoofed" }))
    .toThrow("Invalid admin content action.");
  expect(() => parseAdminContentAction({ action: "delete" }))
    .toThrow("Invalid admin content action.");
  expect(resolveModeratedVisibility("publish", "members")).toBe("members");
  expect(resolveModeratedVisibility("hide", "purchase")).toBe("hidden");
  expect(resolveModeratedVisibility("publish", "hidden", "purchase")).toBe("purchase");
});

test("admin content APIs ignore x-admin-role and require a real admin session", async ({ request }) => {
  const list = await request.get("/api/admin/content", {
    headers: { "x-admin-role": "super_admin" }
  });
  expect(list.status()).toBe(401);

  const mutation = await request.patch("/api/admin/content/post-demo", {
    headers: { ...authHeaders, "x-admin-role": "super_admin" },
    data: { action: "hide", actorUserId: "spoofed" }
  });
  expect(mutation.status()).toBe(401);
});

test("admin content repository exposes canonical creator and moderation counts", async () => {
  const { listAdminContent } = await import("../lib/admin-content-repository");
  const body = await listAdminContent({ status: "published" });

  expect(body.posts.length).toBeGreaterThan(0);
  expect(body.posts[0]).toEqual(expect.objectContaining({
    moderationStatus: "published",
    creator: expect.objectContaining({
      id: expect.any(String),
      name: expect.any(String),
      handle: expect.any(String)
    }),
    commentCount: expect.any(Number),
    mediaCount: expect.any(Number)
  }));
  expect(body.posts[0]).not.toHaveProperty("content");
  expect(body.posts[0]).not.toHaveProperty("comments");
  expect(body.posts[0]).not.toHaveProperty("media");
  await expect(listAdminContent({ cursor: "not-an-opaque-cursor" }))
    .rejects.toThrow("Admin content cursor is invalid.");
});

test("admin content APIs enforce content read and write permissions", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Content role enforcement requires seeded administrator accounts.");

  await signInSupport(request);
  const forbidden = await request.get("/api/admin/content", {
    headers: { "x-admin-role": "super_admin" }
  });
  expect(forbidden.status()).toBe(403);

  await signInAdmin(request);
  const invalidActor = await request.patch("/api/admin/content/post-demo", {
    headers: authHeaders,
    data: { action: "hide", actorUserId: "spoofed" }
  });
  expect(invalidActor.status()).toBe(400);
});
