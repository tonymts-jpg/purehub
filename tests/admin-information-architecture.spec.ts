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
