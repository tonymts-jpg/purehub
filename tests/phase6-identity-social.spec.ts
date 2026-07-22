import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import { authHeaders, hasDatabase, signInCreator, signInFan, signInSupport } from "./auth-helpers";

const password = process.env.DEMO_ACCOUNT_PASSWORD ?? "PureHubDemo!2026";

async function requirePhase6(request: APIRequestContext, testInfo: TestInfo) {
  test.skip(testInfo.project.name === "mobile", "Phase 6 identity mutations run once against the shared staging database.");
  test.skip(!(await hasDatabase(request)), "Phase 6 requires the seeded PostgreSQL database.");
}

test("phase 6 feed exposes stable cursor pagination", async ({ request }) => {
  const first = await request.get("/api/feed");
  expect(first.ok()).toBeTruthy();
  const firstBody = await first.json();
  expect(firstBody.posts).toHaveLength(20);
  expect(firstBody.nextCursor).toBeTruthy();
  const second = await request.get(`/api/feed?cursor=${firstBody.nextCursor}`);
  expect(second.ok()).toBeTruthy();
  const secondBody = await second.json();
  expect(secondBody.posts.some((post: { id: string }) => post.id === firstBody.nextCursor)).toBeFalsy();
});

test("phase 6 credential auth creates secure database sessions", async ({ request }, testInfo) => {
  await requirePhase6(request, testInfo);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const email = `phase6-${suffix}@purehub.local`;
  const handle = `phase6-${suffix}`.slice(0, 30);
  const registered = await request.post("/api/auth/sign-up/email", {
    headers: authHeaders,
    data: { name: "Phase Six Fan", email, password, handle }
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const cookie = registered.headers()["set-cookie"] ?? "";
  expect(cookie.toLowerCase()).toContain("httponly");
  expect(cookie.toLowerCase()).toContain("samesite=lax");

  const me = await request.get("/api/me");
  expect(me.ok()).toBeTruthy();
  const meBody = await me.json();
  expect(meBody.user.email).toBe(email);
  expect(meBody.user.handle).toBe(handle);
  expect(meBody.user.role).toBe("fan");

  const duplicate = await request.post("/api/auth/sign-up/email", {
    headers: authHeaders,
    data: { name: "Duplicate", email, password, handle: `${handle}-x`.slice(0, 30) }
  });
  expect(duplicate.ok()).toBeFalsy();

  expect((await request.post("/api/auth/sign-out", { headers: authHeaders })).ok()).toBeTruthy();
  expect((await request.get("/api/me")).status()).toBe(401);
  expect((await request.post("/api/auth/sign-in/email", { headers: authHeaders, data: { email, password: "DefinitelyWrong!2026" } })).status()).toBe(401);
  expect((await request.post("/api/auth/sign-in/email", { headers: authHeaders, data: { email, password } })).ok()).toBeTruthy();
});

test("phase 6 server authorization rejects spoofed identities and role headers", async ({ request }, testInfo) => {
  await requirePhase6(request, testInfo);
  expect((await request.post("/api/posts", { data: {} })).status()).toBe(401);
  expect((await request.post("/api/payout-requests", { data: { userId: "c1", amount: 100, channel: "alipay" } })).status()).toBe(401);

  await signInFan(request);
  expect((await request.post("/api/posts", { data: { creatorId: "c1" } })).status()).toBe(403);
  expect((await request.get("/api/dashboard/summary?creatorId=c1")).status()).toBe(403);

  await signInCreator(request);
  const ownedPost = await request.post("/api/posts", {
    data: {
      creatorId: "c2",
      title: `Phase 6 ownership ${Date.now()}`,
      excerpt: "Creator ownership cannot be selected by the request body.",
      content: "The authenticated creator remains the owner even when another creator ID is supplied.",
      category: "Cosplay",
      contentType: "long_video",
      saleMode: "long_video_single",
      visibility: "free",
      price: 0
    }
  });
  expect(ownedPost.ok()).toBeTruthy();
  expect((await ownedPost.json()).post.creatorId).toBe("c1");
  expect((await request.post("/api/creators/chenmo/follow", { headers: { origin: "https://evil.example" } })).status()).toBe(403);

  await signInSupport(request);
  const elevated = await request.get("/api/admin/payment-channels", { headers: { "x-admin-role": "super_admin" } });
  expect(elevated.status()).toBe(403);
});

test("phase 6 social interactions are idempotent and notifications are owned", async ({ request }, testInfo) => {
  await requirePhase6(request, testInfo);
  await signInCreator(request);
  const created = await request.post("/api/posts", {
    data: {
      title: `Phase 6 social post ${Date.now()}`,
      excerpt: "Phase 6 identity and social acceptance post.",
      content: "This post validates authenticated likes, bookmarks, comments, and notifications.",
      category: "Cosplay",
      contentType: "long_video",
      saleMode: "long_video_single",
      visibility: "free",
      price: 0
    }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const postId = (await created.json()).post.id as string;

  await signInFan(request);
  for (let index = 0; index < 2; index += 1) {
    expect((await request.post("/api/creators/yuki/follow")).ok()).toBeTruthy();
    expect((await request.post(`/api/posts/${postId}/like`)).ok()).toBeTruthy();
    expect((await request.post(`/api/posts/${postId}/bookmark`)).ok()).toBeTruthy();
  }
  const commentResponse = await request.post(`/api/posts/${postId}/comments`, { data: { content: "Phase 6 authenticated comment" } });
  expect(commentResponse.status()).toBe(201);
  const comment = (await commentResponse.json()).comment as { id: string };
  const post = await (await request.get(`/api/posts/${postId}`)).json();
  expect(post.post.liked).toBe(true);
  expect(post.post.bookmarked).toBe(true);

  await signInCreator(request);
  const notificationResponse = await request.get("/api/notifications?unreadOnly=true");
  expect(notificationResponse.ok()).toBeTruthy();
  const notifications = (await notificationResponse.json()).notifications as Array<{ id: string; type: string; postId?: string }>;
  const related = notifications.filter((item) => item.postId === postId);
  expect(related.filter((item) => item.type === "like")).toHaveLength(1);
  expect(related.filter((item) => item.type === "comment")).toHaveLength(1);
  expect((await request.patch(`/api/notifications/${related[0].id}`)).ok()).toBeTruthy();
  expect((await request.post("/api/notifications/read-all")).ok()).toBeTruthy();

  await signInFan(request);
  expect((await request.delete(`/api/comments/${comment.id}`)).ok()).toBeTruthy();
  expect((await request.delete(`/api/posts/${postId}/like`)).ok()).toBeTruthy();
  expect((await request.delete(`/api/posts/${postId}/bookmark`)).ok()).toBeTruthy();
  expect((await request.delete("/api/creators/yuki/follow")).ok()).toBeTruthy();
});
