import { expect, test } from "@playwright/test";
import { adminNavigationForPermissions } from "../components/admin/admin-nav";
import { canAdminAccess, canAdminManageSettings } from "../lib/admin-auth";
import { getAdminOverview } from "../lib/admin-repository";
import { prisma } from "../lib/prisma";
import { authHeaders, hasDatabase, registerFan, signIn, signInAdmin, signInSupport } from "./auth-helpers";

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
    headers: { ...authHeaders, "x-admin-role": "super_admin" },
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
  const resolveFromHistory = resolveModeratedVisibility as unknown as (
    action: "publish" | "unpublish" | "hide",
    current: string,
    history: readonly string[]
  ) => string;
  expect(resolveFromHistory("publish", "unpublished", ["hidden", "purchase"])).toBe("purchase");
  expect(resolveFromHistory("publish", "unpublished", ["hidden", "members", "hidden", "members"])).toBe("members");
  expect(resolveModeratedVisibility("publish", "free")).toBe("free");
  expect(() => resolveFromHistory("publish", "hidden", []))
    .toThrow("Published visibility history is unavailable.");
});

test("admin members accepts only active or suspended account-state patches", async () => {
  const { parseAdminUserStatePatch } = await import("../lib/admin-repository");

  expect(parseAdminUserStatePatch({ status: "suspended" })).toEqual({ status: "suspended" });
  expect(parseAdminUserStatePatch({ status: "active" })).toEqual({ status: "active" });
  expect(() => parseAdminUserStatePatch({ status: "deleted" })).toThrow("Invalid admin member state.");
  expect(() => parseAdminUserStatePatch({ status: "suspended", actorUserId: "spoofed" }))
    .toThrow("Invalid admin member state.");
  expect(() => parseAdminUserStatePatch({ status: "suspended", role: "admin" }))
    .toThrow("Invalid admin member state.");
});

test("admin members DTO and controls identify administrator accounts without trusting role labels", async () => {
  const { listAdminUsers } = await import("../lib/admin-repository");
  const { memberStatusControlAllowed } = await import("../components/admin/members-page");
  const users = await listAdminUsers();
  const administrator = users.find((user) => user.id === "admin-demo");

  expect(administrator).toMatchObject({
    isAdministrator: true,
    manageable: false
  });
  expect(administrator).not.toHaveProperty("adminAccounts");
  expect(memberStatusControlAllowed(true, {
    role: "fan",
    isAdministrator: true,
    manageable: false
  })).toBe(false);
  expect(memberStatusControlAllowed(true, {
    role: "admin",
    isAdministrator: false,
    manageable: true
  })).toBe(true);
  expect(memberStatusControlAllowed(false, {
    role: "fan",
    isAdministrator: false,
    manageable: true
  })).toBe(false);
});

test("admin members updates state only after a successful server response", async () => {
  const { updateAdminMemberStatus } = await import("../components/admin/members-page");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const success = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ user: { id: "member-1", status: "suspended" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const failed = async () => new Response(JSON.stringify({ error: "mutation failed visibly" }), {
    status: 500,
    headers: { "content-type": "application/json" }
  });

  await expect(updateAdminMemberStatus("member-1", "suspended", success)).resolves.toEqual({
    id: "member-1",
    status: "suspended"
  });
  expect(calls).toEqual([{
    url: "/api/admin/users/member-1",
    init: expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "suspended" })
    })
  }]);
  await expect(updateAdminMemberStatus("member-1", "suspended", failed))
    .rejects.toThrow("mutation failed visibly");
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

  const malformed = await request.patch("/api/admin/content/post-demo", {
    headers: { ...authHeaders, "content-type": "application/json" },
    data: "{"
  });
  expect(malformed.status()).toBe(400);

  const missing = await request.patch("/api/admin/content/post-demo", {
    headers: authHeaders
  });
  expect(missing.status()).toBe(400);
});

test("admin content repository preserves paid visibility through repeated moderation history", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Moderation transaction coverage requires the seeded database.");
  const { moderateAdminContent } = await import("../lib/admin-content-repository");
  const id = `task10-paid-${Date.now().toString(36)}`;
  const admin = { actorUserId: "admin-demo", role: "super_admin" as const };

  await prisma.post.create({
    data: {
      id,
      creatorId: "c1",
      title: "Task 10 paid moderation",
      excerpt: "Visibility history fixture",
      content: "Private paid content",
      cover: "cover-1",
      category: "Test",
      tags: [],
      visibility: "purchase",
      comments: []
    }
  });
  try {
    expect((await moderateAdminContent(admin, id, { action: "hide" })).visibility).toBe("hidden");
    expect((await moderateAdminContent(admin, id, { action: "unpublish" })).visibility).toBe("unpublished");
    expect((await moderateAdminContent(admin, id, { action: "publish" })).visibility).toBe("purchase");
    expect((await moderateAdminContent(admin, id, { action: "hide" })).visibility).toBe("hidden");
    expect((await moderateAdminContent(admin, id, { action: "unpublish" })).visibility).toBe("unpublished");
    expect((await moderateAdminContent(admin, id, { action: "publish" })).visibility).toBe("purchase");
    expect(await prisma.auditLog.count({
      where: { targetType: "post", targetId: id, actorUserId: admin.actorUserId }
    })).toBe(6);
  } finally {
    await prisma.auditLog.deleteMany({ where: { targetType: "post", targetId: id } });
    await prisma.post.deleteMany({ where: { id } });
  }
});

test("admin content publish rejects missing canonical visibility history without mutation", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Moderation transaction coverage requires the seeded database.");
  const { moderateAdminContent } = await import("../lib/admin-content-repository");
  const id = `task10-historyless-${Date.now().toString(36)}`;
  const admin = { actorUserId: "admin-demo", role: "super_admin" as const };

  await prisma.post.create({
    data: {
      id,
      creatorId: "c1",
      title: "Task 10 historyless moderation",
      excerpt: "Visibility history rejection fixture",
      content: "Content whose former entitlement is unknown",
      cover: "cover-1",
      category: "Test",
      tags: [],
      visibility: "hidden",
      comments: []
    }
  });
  try {
    await expect(moderateAdminContent(admin, id, { action: "publish" }))
      .rejects.toThrow("Published visibility history is unavailable.");
    expect((await prisma.post.findUniqueOrThrow({ where: { id } })).visibility).toBe("hidden");
    expect(await prisma.auditLog.count({ where: { targetType: "post", targetId: id } })).toBe(0);
    expect(await prisma.channelJob.count({ where: { entityType: "post", entityId: id } })).toBe(0);

    await signInAdmin(request);
    const response = await request.patch(`/api/admin/content/${id}`, {
      headers: authHeaders,
      data: { action: "publish" }
    });
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({
      error: "Published visibility history is unavailable."
    });
    expect((await prisma.post.findUniqueOrThrow({ where: { id } })).visibility).toBe("hidden");
    expect(await prisma.auditLog.count({ where: { targetType: "post", targetId: id } })).toBe(0);
    expect(await prisma.channelJob.count({ where: { entityType: "post", entityId: id } })).toBe(0);
  } finally {
    await prisma.channelJob.deleteMany({ where: { entityType: "post", entityId: id } });
    await prisma.auditLog.deleteMany({ where: { targetType: "post", targetId: id } });
    await prisma.post.deleteMany({ where: { id } });
  }
});

test("admin members API writes authenticated account state and audit atomically", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Member mutation coverage requires the seeded database.");
  const identity = await registerFan(request, "task10-member-state");
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: identity.email },
    select: { id: true }
  });

  try {
    await signInAdmin(request);
    const missingOrigin = await request.patch(`/api/admin/users/${user.id}`, {
      data: { status: "suspended" }
    });
    expect(missingOrigin.status()).toBe(403);
    const suspended = await request.patch(`/api/admin/users/${user.id}`, {
      headers: authHeaders,
      data: { status: "suspended" }
    });
    expect(suspended.status()).toBe(200);
    expect((await suspended.json()).user.status).toBe("suspended");
    expect(await prisma.auditLog.count({
      where: {
        actorUserId: "admin-demo",
        action: "admin.user.update",
        targetType: "user",
        targetId: user.id
      }
    })).toBe(1);

    const actorOverride = await request.patch(`/api/admin/users/${user.id}`, {
      headers: authHeaders,
      data: { status: "active", actorUserId: "spoofed" }
    });
    expect(actorOverride.status()).toBe(400);
    const roleEscalation = await request.patch(`/api/admin/users/${user.id}`, {
      headers: authHeaders,
      data: { status: "active", role: "admin" }
    });
    expect(roleEscalation.status()).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("suspended");
  } finally {
    await prisma.auditLog.deleteMany({ where: { targetType: "user", targetId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});

test("admin members management rejects every AdminAccount target in repository and route", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Administrator target protection requires the seeded database.");
  const { updateAdminUser } = await import("../lib/admin-repository");
  const identity = await registerFan(request, "task10-ops-target");
  const opsUser = await prisma.user.findUniqueOrThrow({
    where: { email: identity.email },
    select: { id: true, status: true }
  });
  await prisma.adminAccount.create({
    data: { userId: opsUser.id, role: "ops_admin", status: "active" }
  });

  try {
    const auditCount = await prisma.auditLog.count({
      where: { action: "admin.user.update", targetType: "user", targetId: opsUser.id }
    });
    const jobCount = await prisma.channelJob.count({
      where: { entityType: "creator", entityId: opsUser.id }
    });
    await expect(updateAdminUser(
      { actorUserId: "admin-demo", role: "super_admin" },
      opsUser.id,
      { status: "suspended" }
    )).rejects.toThrow("Administrator accounts cannot be managed from Member Management.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: opsUser.id } })).status).toBe(opsUser.status);
    expect(await prisma.auditLog.count({
      where: { action: "admin.user.update", targetType: "user", targetId: opsUser.id }
    })).toBe(auditCount);
    expect(await prisma.channelJob.count({
      where: { entityType: "creator", entityId: opsUser.id }
    })).toBe(jobCount);

    const superAdminBefore = await prisma.user.findUniqueOrThrow({
      where: { id: "admin-demo" },
      select: { status: true }
    });
    const superAuditCount = await prisma.auditLog.count({
      where: { action: "admin.user.update", targetType: "user", targetId: "admin-demo" }
    });
    const superJobCount = await prisma.channelJob.count({
      where: { entityType: "creator", entityId: "admin-demo" }
    });
    await signIn(request, identity.email);
    const response = await request.patch("/api/admin/users/admin-demo", {
      headers: authHeaders,
      data: { status: "suspended" }
    });
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({
      error: "Administrator accounts cannot be managed from Member Management."
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: "admin-demo" } })).status)
      .toBe(superAdminBefore.status);
    expect(await prisma.auditLog.count({
      where: { action: "admin.user.update", targetType: "user", targetId: "admin-demo" }
    })).toBe(superAuditCount);
    expect(await prisma.channelJob.count({
      where: { entityType: "creator", entityId: "admin-demo" }
    })).toBe(superJobCount);

    const selfResponse = await request.patch(`/api/admin/users/${opsUser.id}`, {
      headers: authHeaders,
      data: { status: "suspended" }
    });
    expect(selfResponse.status()).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: opsUser.id } })).status).toBe(opsUser.status);
    expect(await prisma.auditLog.count({
      where: { action: "admin.user.update", targetType: "user", targetId: opsUser.id }
    })).toBe(auditCount);
    expect(await prisma.channelJob.count({
      where: { entityType: "creator", entityId: opsUser.id }
    })).toBe(jobCount);
  } finally {
    await prisma.auditLog.deleteMany({ where: { targetType: "user", targetId: opsUser.id } });
    await prisma.channelJob.deleteMany({ where: { entityType: "creator", entityId: opsUser.id } });
    await prisma.session.deleteMany({ where: { userId: opsUser.id } });
    await prisma.account.deleteMany({ where: { userId: opsUser.id } });
    await prisma.adminAccount.deleteMany({ where: { userId: opsUser.id } });
    await prisma.user.deleteMany({ where: { id: opsUser.id } });
  }
});

test("admin overview and domain pages isolate real browser requests and preserve queue URLs", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Protected admin browser acceptance requires seeded administrator accounts.");
  await signInAdmin(page.request);
  const calls: string[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    calls.push(`${url.pathname}${url.search}`);
    if (route.request().method() === "PATCH" && url.pathname === "/api/admin/users/member-admin") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "member update failed visibly" })
      });
    }
    const bodies: Record<string, unknown> = {
      "/api/admin/overview": {
        metrics: { users: 2, creators: 1, posts: 1, transactions: 0 },
        queues: {
          pendingApplications: 1,
          pendingContent: 1,
          pendingChannels: 1,
          pendingRefunds: 1,
          pendingPayouts: 1,
          reconciliationExceptions: 1
        },
        admin: { role: "super_admin", permissions: ["overview", "members", "creators", "content", "channels"] }
      },
      "/api/admin/users": {
        users: [
          {
            id: "member-admin",
            name: "Alice Creator",
            handle: "alice",
            status: "active",
            role: "creator",
            creatorStatus: "approved",
            isAdministrator: false,
            manageable: true,
            creatorProfile: { followers: 10, members: 1, levelId: "level-1" }
          },
          {
            id: "administrator-with-fan-role",
            name: "Ops Account",
            handle: "ops-account",
            status: "active",
            role: "fan",
            creatorStatus: "none",
            isAdministrator: true,
            manageable: false,
            creatorProfile: null
          }
        ]
      },
      "/api/admin/creator-applications": { applications: [] },
      "/api/admin/creator-levels": { levels: [] },
      "/api/admin/content": { posts: [], nextCursor: null },
      "/api/admin/channels": { channels: [], nextCursor: null }
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bodies[url.pathname] ?? {})
    });
  });

  await page.goto("/admin");
  await expect(page.getByTestId("admin-work-queues")).toBeVisible();
  await expect(page.getByRole("link", { name: /待审创作者/ })).toHaveAttribute("href", "/admin/creators?status=pending");
  await expect(page.getByRole("link", { name: /待审内容/ })).toHaveAttribute("href", "/admin/content?status=pending");
  await expect(page.getByRole("link", { name: /待审频道/ })).toHaveAttribute("href", "/admin/channels?status=pending");
  await expect(page.getByRole("link", { name: /待处理退款/ })).toHaveAttribute("href", "/admin/finance?tab=refunds&status=pending");
  await expect(page.getByRole("link", { name: /待处理提现/ })).toHaveAttribute("href", "/admin/finance?tab=payouts&status=pending");
  await expect(page.getByRole("link", { name: /对账异常/ })).toHaveAttribute("href", "/admin/finance?tab=reconciliation&status=exception");
  expect([...new Set(calls)]).toEqual(["/api/admin/overview"]);

  calls.length = 0;
  await page.getByRole("link", { name: /待审创作者/ }).click();
  await expect(page).toHaveURL(/\/admin\/creators\?status=pending$/);
  await expect(page.getByRole("heading", { name: "创作者管理" })).toBeVisible();
  expect([...new Set(calls)].sort()).toEqual([
    "/api/admin/creator-applications?status=pending",
    "/api/admin/creator-levels"
  ]);

  calls.length = 0;
  await page.goto("/admin/members?q=alice&role=creator&status=active");
  await expect(page.getByRole("heading", { name: "会员管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停账号 Alice Creator" })).toBeVisible();
  expect([...new Set(calls)]).toEqual(["/api/admin/users?q=alice&role=creator&status=active"]);
  await page.getByRole("button", { name: "暂停账号 Alice Creator" }).click();
  await expect(page.getByRole("alert")).toContainText("member update failed visibly");
  await expect(page.getByText("active", { exact: true })).toBeVisible();

  calls.length = 0;
  await page.goto("/admin/members?q=ops");
  await expect(page.getByText("Ops Account")).toBeVisible();
  await expect(page.getByText("管理员账号")).toBeVisible();
  await expect(page.getByRole("button", { name: /Ops Account/ })).toHaveCount(0);
  expect([...new Set(calls)]).toEqual(["/api/admin/users?q=ops"]);

  calls.length = 0;
  await page.goto("/admin/content?status=pending&q=photo");
  await expect(page.getByRole("heading", { name: "内容管理" })).toBeVisible();
  await expect(page.getByText("没有符合条件的内容")).toBeVisible();
  expect([...new Set(calls)]).toEqual(["/api/admin/content?status=pending&q=photo"]);

  calls.length = 0;
  await page.goto("/admin/channels?status=pending");
  await expect(page.getByRole("heading", { name: "频道管理" })).toBeVisible();
  await expect(page.getByTestId("admin-channel-operations")).toBeVisible();
  expect(calls.every((url) => /^\/api\/admin\/channels(?:\?.*)?$/.test(url))).toBe(true);
});

test("admin members and creators render authenticated support read-only browser controls", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Protected support browser acceptance requires seeded administrator accounts.");
  await signInSupport(page.request);
  await page.route("**/api/admin/users**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      users: [{
        id: "member-1",
        name: "只读会员",
        handle: "readonly-member",
        status: "active",
        role: "fan",
        creatorStatus: "none",
        isAdministrator: false,
        manageable: true,
        creatorProfile: null
      }]
    })
  }));
  await page.route("**/api/admin/creator-applications**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      applications: [{
        id: "application-1",
        displayName: "只读创作者",
        category: "摄影",
        contact: "readonly@example.com",
        status: "pending",
        user: { handle: "readonly-creator" }
      }]
    })
  }));
  await page.route("**/api/admin/creator-levels", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ levels: [] })
  }));

  await page.goto("/admin/members");
  await expect(page.getByRole("heading", { name: "会员管理" })).toBeVisible();
  await expect(page.getByLabel("搜索会员")).toBeVisible();
  await expect(page.getByRole("button", { name: /暂停账号|恢复账号/ })).toHaveCount(0);

  await page.goto("/admin/creators?status=pending");
  await expect(page.getByRole("heading", { name: "创作者管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "通过" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "拒绝" })).toHaveCount(0);
  await expect(page.getByText("只读", { exact: true })).toBeVisible();
});

test("admin finance request isolation preserves URL state and loads only the active canonical endpoint", async () => {
  const calls: string[] = [];
  const { loadAdminFinance } = await import("../components/admin/finance-page");
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ payouts: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await loadAdminFinance("payouts", new URLSearchParams("status=pending&actorUserId=spoofed"), fetcher);

  expect(calls).toEqual(["/api/admin/finance/payout-requests?status=pending"]);
  expect(calls.some((url) => /pricing|payment-channels|audit-logs/.test(url))).toBe(false);
});

test("admin finance maps every URL-backed tab to one canonical read endpoint", async () => {
  const { adminFinanceListUrl } = await import("../components/admin/finance-page");

  expect(adminFinanceListUrl("orders", new URLSearchParams())).toBe("/api/admin/finance/transactions?view=orders");
  expect(adminFinanceListUrl("payments", new URLSearchParams())).toBe("/api/admin/finance/ledger");
  expect(adminFinanceListUrl("refunds", new URLSearchParams("status=pending"))).toBe("/api/admin/finance/transactions?view=refunds&status=pending");
  expect(adminFinanceListUrl("payouts", new URLSearchParams("status=pending"))).toBe("/api/admin/finance/payout-requests?status=pending");
  expect(adminFinanceListUrl("kyc", new URLSearchParams())).toBe("/api/admin/finance/kyc-cases");
  expect(adminFinanceListUrl("reconciliation", new URLSearchParams("status=exception"))).toBe("/api/admin/finance/reconciliation?status=exception");
});

test("admin refund and payout retries apply patches to the latest two-row state", async () => {
  const { applyFinanceRowPatch, requestFinanceRowPatch } = await import("../components/admin/finance-page");
  const original = [
    { id: "payout-1", status: "pending", amount: 100 },
    { id: "payout-2", status: "pending", amount: 200 }
  ];
  let firstAttempts = 0;
  const retryFirst = () => requestFinanceRowPatch(
    "payout-1",
    "/api/admin/finance/payout-requests",
    { method: "PATCH", body: JSON.stringify({ id: "payout-1", status: "approved" }) },
    (body) => (body as { payout: { id: string; status: string } }).payout,
    async () => {
      firstAttempts += 1;
      return new Response(JSON.stringify(firstAttempts === 1
        ? { error: "请重试提现审核" }
        : { payout: { id: "payout-1", status: "approved" } }), {
        status: firstAttempts === 1 ? 500 : 200,
        headers: { "content-type": "application/json" }
      });
    }
  );

  await expect(retryFirst()).rejects.toThrow("请重试提现审核");
  const secondPatch = await requestFinanceRowPatch(
    "payout-2",
    "/api/admin/finance/payout-requests",
    { method: "PATCH", body: JSON.stringify({ id: "payout-2", status: "rejected" }) },
    (body) => (body as { payout: { id: string; status: string } }).payout,
    async () => new Response(JSON.stringify({ payout: { id: "payout-2", status: "rejected" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
  let current = applyFinanceRowPatch(original, secondPatch);
  current = applyFinanceRowPatch(current, await retryFirst());

  expect(current).toEqual([
    { id: "payout-1", status: "approved", amount: 100 },
    { id: "payout-2", status: "rejected", amount: 200 }
  ]);
  expect(original.every((row) => row.status === "pending")).toBe(true);
});

test("admin finance separates deduplicated eligible orders from refund rows", async () => {
  const { canRefundFinanceOrder, financeRowsForTab } = await import("../components/admin/finance-page");
  const fulfilled = { id: "order-1", status: "fulfilled", amount: 100, currency: "CNY", successfulPayment: true };
  const body = {
    orders: [fulfilled, { ...fulfilled }, { id: "order-refunded", status: "refunded", successfulPayment: false }],
    refunds: [
      { id: "refund-1", orderId: "order-refunded", status: "succeeded", source: "admin" },
      { id: "refund-2", orderId: "order-charged", status: "succeeded", source: "chargeback" }
    ]
  };

  expect(financeRowsForTab("orders", body).map((row: { id: string }) => row.id)).toEqual(["order-1"]);
  expect(financeRowsForTab("refunds", body).map((row: { id: string }) => row.id)).toEqual(["refund-1", "refund-2"]);
  expect(canRefundFinanceOrder(fulfilled)).toBe(true);
  expect(canRefundFinanceOrder({ ...fulfilled, status: "refunded" })).toBe(false);
  expect(canRefundFinanceOrder({ ...fulfilled, successfulPayment: false })).toBe(false);
  expect(canRefundFinanceOrder(body.refunds[0])).toBe(false);
});

test("admin reconciliation columns align one semantic cell with every header", async () => {
  const { financeColumnsForTab } = await import("../components/admin/finance-page");
  const columns = financeColumnsForTab("reconciliation");

  expect(columns.map((column: { key: string }) => column.key)).toEqual([
    "time",
    "payments",
    "ledger",
    "wallets",
    "result",
    "operation"
  ]);
  expect(columns.map((column: { header: string }) => column.header)).toEqual([
    "时间",
    "支付",
    "账本",
    "钱包",
    "结果",
    "操作"
  ]);
});

test("admin settings request isolation follows exact finance and operational capabilities", async () => {
  const calls: string[] = [];
  const { loadAdminSettings, settingsGroupsForCapabilities } = await import("../components/admin/settings-page");
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = url.includes("fee-configs") || url.includes("settlement-configs")
      ? { configs: [] }
      : url.includes("pricing")
        ? { versions: [] }
        : { channels: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await loadAdminSettings({ finance: true, operations: false }, fetcher);
  expect(calls).toEqual([
    "/api/admin/finance/fee-configs",
    "/api/admin/finance/settlement-configs"
  ]);
  expect(settingsGroupsForCapabilities({ finance: true, operations: false })).toEqual([
    "platform-fee",
    "settlement-window"
  ]);
  expect(calls.some((url) => /pricing|payment-channels|audit-logs/.test(url))).toBe(false);

  calls.length = 0;
  await loadAdminSettings({ finance: false, operations: true }, fetcher);
  expect(calls).toEqual([
    "/api/admin/pricing/versions",
    "/api/admin/payment-channels"
  ]);
  expect(settingsGroupsForCapabilities({ finance: false, operations: true })).toEqual([
    "pricing",
    "payment-channels"
  ]);
  expect(calls.some((url) => /fee-configs|settlement-configs|audit-logs/.test(url))).toBe(false);
});

test("admin audit request isolation forwards only the opaque cursor and exposes no mutation contract", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const { loadAdminAudit } = await import("../components/admin/audit-page");
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ logs: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const body = await loadAdminAudit(new URLSearchParams("cursor=opaque-cursor&actorUserId=spoofed"), fetcher);

  expect(calls).toEqual([{ url: "/api/admin/audit-logs?cursor=opaque-cursor", init: undefined }]);
  expect(body).toEqual({ logs: [], nextCursor: null });
});

test("admin audit cursor is opaque, strict, and round-trips its stable marker", async () => {
  const { encodeAuditCursor, parseAuditCursor } = await import("../app/api/admin/audit-logs/route");
  const marker = { createdAt: "2026-07-30T12:00:00.000Z", id: "audit-20" };
  const cursor = encodeAuditCursor(marker);

  expect(cursor).not.toContain(marker.id);
  expect(parseAuditCursor(cursor)).toEqual({ createdAt: new Date(marker.createdAt), id: marker.id });
  expect(() => parseAuditCursor("not-a-cursor")).toThrow("Audit cursor is invalid.");
});

test("admin audit repository cursor predicate follows deterministic descending ties", async () => {
  const { adminAuditCursorWhere } = await import("../lib/admin-repository");
  const createdAt = new Date("2026-07-30T12:00:00.000Z");

  expect(adminAuditCursorWhere({ createdAt, id: "audit-20" })).toEqual({
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: "audit-20" } }
    ]
  });
});

test("admin audit repository paginates beyond 100 rows with ties and ignores newer insertions", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Audit repository pagination requires PostgreSQL.");
  const { listAuditLogs } = await import("../lib/admin-repository");
  const nonce = Date.now().toString(36);
  const targetType = `audit-page-${nonce}`;
  const tiedAt = new Date("2099-07-30T12:00:00.000Z");
  const ids = Array.from({ length: 125 }, (_, index) => `audit-${nonce}-${String(index).padStart(3, "0")}`);

  try {
    await prisma.auditLog.createMany({
      data: ids.map((id) => ({
        id,
        actorRole: "analyst",
        action: "audit.pagination.test",
        targetType,
        targetId: id,
        metadata: {},
        createdAt: tiedAt
      }))
    });

    const first = await listAuditLogs({ pageSize: 20 });
    const expected = [...ids].sort((left, right) => right.localeCompare(left));
    expect(first.logs.map((log) => log.id)).toEqual(expected.slice(0, 20));
    expect(first.nextCursor).toEqual({ createdAt: tiedAt, id: expected[19] });

    const insertedId = `audit-${nonce}-newer`;
    await prisma.auditLog.create({
      data: {
        id: insertedId,
        actorRole: "analyst",
        action: "audit.pagination.inserted",
        targetType,
        targetId: insertedId,
        metadata: {},
        createdAt: new Date("2100-01-01T00:00:00.000Z")
      }
    });
    const second = await listAuditLogs({ cursor: first.nextCursor, pageSize: 20 });

    expect(second.logs.map((log) => log.id)).toEqual(expected.slice(20, 40));
    expect(second.logs.some((log) => log.id === insertedId)).toBe(false);
    expect(new Set([...first.logs, ...second.logs].map((log) => log.id)).size).toBe(40);

    await signInAdmin(request);
    const routeFirst = await request.get("/api/admin/audit-logs");
    expect(routeFirst.ok()).toBeTruthy();
    const routeFirstBody = await routeFirst.json();
    expect(routeFirstBody.logs).toHaveLength(20);
    expect(routeFirstBody.nextCursor).toBeTruthy();
    const routeSecond = await request.get(`/api/admin/audit-logs?cursor=${encodeURIComponent(routeFirstBody.nextCursor)}`);
    expect(routeSecond.ok()).toBeTruthy();
    const routeSecondBody = await routeSecond.json();
    expect(new Set([...routeFirstBody.logs, ...routeSecondBody.logs].map((log: { id: string }) => log.id)).size).toBe(40);
    expect((await request.get("/api/admin/audit-logs?cursor=bad-cursor")).status()).toBe(400);
  } finally {
    await prisma.auditLog.deleteMany({ where: { targetType } });
  }
});

test("admin finance repository returns unique eligible orders and only canonical refunds", async ({ request }) => {
  test.skip(!(await hasDatabase(request)), "Finance repository semantics require PostgreSQL.");
  const { listFinanceOrders, listFinanceRefunds } = await import("../lib/payments/repository");
  const nonce = Date.now().toString(36);
  const eligibleId = `finance-order-eligible-${nonce}`;
  const refundedId = `finance-order-refunded-${nonce}`;
  const chargedId = `finance-order-charged-${nonce}`;
  const orderIds = [eligibleId, refundedId, chargedId];

  try {
    await prisma.order.createMany({
      data: [
        { id: eligibleId, buyerUserId: "fan-demo", creatorUserId: "c1", kind: "post_unlock", itemId: "p1", amount: 100, currency: "CNY", status: "fulfilled", provider: "card", createdAt: new Date("2099-07-30T12:00:03.000Z") },
        { id: refundedId, buyerUserId: "fan-demo", creatorUserId: "c1", kind: "post_unlock", itemId: "p2", amount: 120, currency: "CNY", status: "refunded", provider: "card", createdAt: new Date("2099-07-30T12:00:02.000Z") },
        { id: chargedId, buyerUserId: "fan-demo", creatorUserId: "c1", kind: "subscription", itemId: "p12", amount: 140, currency: "CNY", status: "charged_back", provider: "card", createdAt: new Date("2099-07-30T12:00:01.000Z") }
      ]
    });
    await prisma.paymentTransaction.createMany({
      data: [
        { id: `finance-payment-a-${nonce}`, orderId: eligibleId, provider: "card", amount: 100, currency: "CNY", status: "succeeded", platformFeeBps: 1000, platformFeeAmount: 10, creatorNetAmount: 90 },
        { id: `finance-payment-b-${nonce}`, orderId: eligibleId, provider: "card", amount: 100, currency: "CNY", status: "failed", platformFeeBps: 1000, platformFeeAmount: 10, creatorNetAmount: 90 },
        { id: `finance-payment-refund-${nonce}`, orderId: refundedId, provider: "card", amount: 120, currency: "CNY", status: "refunded", platformFeeBps: 1000, platformFeeAmount: 12, creatorNetAmount: 108 },
        { id: `finance-payment-charge-${nonce}`, orderId: chargedId, provider: "card", amount: 140, currency: "CNY", status: "charged_back", platformFeeBps: 1000, platformFeeAmount: 14, creatorNetAmount: 126 }
      ]
    });
    await prisma.refund.createMany({
      data: [
        { id: `finance-refund-${nonce}`, orderId: refundedId, reason: "review refund", status: "succeeded", source: "admin" },
        { id: `finance-chargeback-${nonce}`, orderId: chargedId, reason: "review chargeback", status: "succeeded", source: "chargeback" }
      ]
    });

    const orders = await listFinanceOrders();
    const refunds = await listFinanceRefunds();
    expect(orders.filter((order) => order.id === eligibleId)).toHaveLength(1);
    expect(orders.some((order) => order.id === refundedId || order.id === chargedId)).toBe(false);
    expect(orders.find((order) => order.id === eligibleId)?.successfulPayment).toBe(true);
    expect(refunds.filter((refund) => refund.orderId === refundedId || refund.orderId === chargedId).map((refund) => refund.source).sort()).toEqual(["admin", "chargeback"]);

    await signInAdmin(request);
    const orderResponse = await request.get("/api/admin/finance/transactions?view=orders");
    const refundResponse = await request.get("/api/admin/finance/transactions?view=refunds");
    expect(orderResponse.ok()).toBeTruthy();
    expect(refundResponse.ok()).toBeTruthy();
    expect((await orderResponse.json()).orders.filter((order: { id: string }) => order.id === eligibleId)).toHaveLength(1);
    expect((await refundResponse.json()).refunds.filter((refund: { orderId: string }) => orderIds.includes(refund.orderId))).toHaveLength(2);
    expect((await request.get("/api/admin/finance/transactions?view=orders&actorUserId=spoofed")).status()).toBe(400);
  } finally {
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
});

test("admin finance settings and audit pages isolate authenticated browser requests and URL tabs", async ({ page }, testInfo) => {
  test.skip(!(await hasDatabase(page.request)), "Authenticated Task 11 pages require seeded administrator accounts.");
  await signInAdmin(page.request);
  const calls: string[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    calls.push(`${url.pathname}${url.search}`);
    const bodies: Record<string, unknown> = {
      "/api/admin/finance/payout-requests": { payouts: [{ id: "payout-browser", status: "pending", amount: 100, channel: "alipay", user: { name: "浏览器创作者", handle: "browser-creator" } }] },
      "/api/admin/finance/transactions": { orders: [{ id: "order-browser", status: "fulfilled", amount: 100, currency: "CNY", provider: "card", kind: "post_unlock", successfulPayment: true }] },
      "/api/admin/pricing/versions": { versions: [] },
      "/api/admin/finance/fee-configs": { configs: [] },
      "/api/admin/finance/settlement-configs": { configs: [] },
      "/api/admin/payment-channels": { channels: [] },
      "/api/admin/audit-logs": { logs: [{ id: "audit-browser", actorUserId: "admin-demo", actorRole: "super_admin", action: "finance.review", targetType: "order", targetId: "order-browser", metadata: { result: "success" }, createdAt: "2026-07-30T12:00:00.000Z" }], nextCursor: null }
    };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bodies[url.pathname] ?? {}) });
  });

  await page.goto("/admin/finance?tab=payouts&status=pending");
  await expect(page.getByRole("heading", { name: "订单与财务" })).toBeVisible();
  expect([...new Set(calls)]).toEqual(["/api/admin/finance/payout-requests?status=pending"]);

  calls.length = 0;
  await page.getByRole("link", { name: "订单", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/finance\?tab=orders$/);
  expect([...new Set(calls)]).toEqual(["/api/admin/finance/transactions?view=orders"]);
  if (testInfo.project.name === "mobile") {
    await expect(page.getByTestId("finance-mobile-list")).toBeVisible();
    await expect(page.getByTestId("finance-desktop-table")).toBeHidden();
    await expect(page.getByTestId("finance-mobile-list").getByText("order-browser", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByTestId("finance-desktop-table")).toBeVisible();
    await expect(page.getByTestId("finance-mobile-list")).toBeHidden();
    await expect(page.getByTestId("finance-desktop-table").getByText("order-browser", { exact: true })).toBeVisible();
  }

  calls.length = 0;
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "平台设置" })).toBeVisible();
  expect([...new Set(calls)].sort()).toEqual([
    "/api/admin/finance/fee-configs",
    "/api/admin/finance/settlement-configs",
    "/api/admin/payment-channels",
    "/api/admin/pricing/versions"
  ]);

  calls.length = 0;
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
  expect([...new Set(calls)]).toEqual(["/api/admin/audit-logs"]);
  if (testInfo.project.name === "mobile") {
    await expect(page.getByTestId("audit-mobile-list")).toBeVisible();
  } else {
    await expect(page.getByTestId("audit-desktop-table")).toBeVisible();
  }
});

test("admin finance role cannot unlock operational settings with x-admin-role", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Finance role page acceptance requires PostgreSQL.");
  const identity = await createTemporaryAdmin(page.request, "finance_admin", "task11-finance");
  try {
    await page.setExtraHTTPHeaders({ "x-admin-role": "super_admin" });
    const calls: string[] = [];
    await page.route("**/api/admin/**", async (route) => {
      const url = new URL(route.request().url());
      calls.push(url.pathname);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configs: [] }) });
    });
    await page.goto("/admin/settings");

    await expect(page.getByTestId("settings-platform-fee")).toBeVisible();
    await expect(page.getByTestId("settings-settlement-window")).toBeVisible();
    await expect(page.getByTestId("settings-pricing")).toHaveCount(0);
    await expect(page.getByTestId("settings-payment-channels")).toHaveCount(0);
    expect([...new Set(calls)].sort()).toEqual([
      "/api/admin/finance/fee-configs",
      "/api/admin/finance/settlement-configs"
    ]);
  } finally {
    await removeTemporaryAdmin(identity.userId);
  }
});

test("admin analyst sees read-only audit and x-admin-role cannot unlock finance", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Analyst page acceptance requires PostgreSQL.");
  const identity = await createTemporaryAdmin(page.request, "analyst", "task11-analyst");
  try {
    await page.setExtraHTTPHeaders({ "x-admin-role": "super_admin" });
    await page.route("**/api/admin/audit-logs**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ logs: [{ id: "analyst-audit", actorUserId: null, actorRole: "system", action: "read.only", targetType: "system", targetId: "one", metadata: {}, createdAt: "2026-07-30T12:00:00.000Z" }], nextCursor: null })
    }));
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
    await expect(page.getByRole("button", { name: /退款|审核|对账|结算|发布|启用|停用/ })).toHaveCount(0);

    await page.goto("/admin/finance");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "订单与财务" })).toHaveCount(0);
  } finally {
    await removeTemporaryAdmin(identity.userId);
  }
});

test("admin finance page exposes loading forbidden and retry states and handles API 401 safely", async ({ page }) => {
  test.skip(!(await hasDatabase(page.request)), "Protected finance error-state acceptance requires seeded admin authentication.");
  await signInAdmin(page.request);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let attempts = 0;
  await page.route("**/api/admin/finance/payout-requests**", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await gate;
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "forbidden" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payouts: [] }) });
  });
  await page.goto("/admin/finance?tab=payouts");
  await expect(page.getByText("正在加载提现…")).toBeVisible();
  release();
  await expect(page.getByText("当前管理员没有访问财务分区的权限。")).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("暂无提现记录")).toBeVisible();

  await page.route("**/api/admin/audit-logs**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "expired" }) }));
  await page.goto("/admin/audit");
  await expect(page).toHaveURL("/admin/sign-in");
});

async function createTemporaryAdmin(request: Parameters<typeof registerFan>[0], role: "finance_admin" | "analyst", label: string) {
  const identity = await registerFan(request, label);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: identity.email }, select: { id: true } });
  await prisma.adminAccount.create({ data: { userId: user.id, role, status: "active" } });
  return { userId: user.id };
}

async function removeTemporaryAdmin(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.adminAccount.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}
