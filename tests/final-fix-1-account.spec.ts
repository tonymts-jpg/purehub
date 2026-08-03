import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import { parseAccountCursor } from "../lib/account/cursor";
import { moderateAdminContent } from "../lib/admin-content-repository";
import { PUBLISHABLE_POST_VISIBILITIES } from "../lib/post-visibility";
import { prisma } from "../lib/prisma";
import { hasDatabase, registerFan, signIn } from "./auth-helpers";

async function requireDatabase(request: APIRequestContext, testInfo: TestInfo) {
  test.skip(testInfo.project.name === "mobile", "Final account database coverage runs once.");
  test.skip(!(await hasDatabase(request)), "Final account hardening requires PostgreSQL.");
}

test("canonical publishable visibility is exactly free members and purchase", () => {
  expect(PUBLISHABLE_POST_VISIBILITIES).toEqual(["free", "members", "purchase"]);
});

test("moderated posts fail closed across public, media, and account pagination", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  const identity = await registerFan(request, "final-visibility");
  await signIn(request, identity.email);
  const viewerId = (await (await request.get("/api/me")).json()).user.id as string;
  const nonce = Date.now().toString(36);
  const creatorId = `final-creator-${nonce}`;
  const handle = `final-creator-${nonce}`.slice(0, 30);
  const posts = [
    { id: `final-new-${nonce}`, visibility: "purchase", title: "Newest publishable", createdAt: new Date("2026-07-30T05:00:00.000Z") },
    { id: `final-hidden-${nonce}`, visibility: "hidden", title: `hidden-secret-${nonce}`, createdAt: new Date("2026-07-30T04:00:00.000Z") },
    { id: `final-old-${nonce}`, visibility: "purchase", title: "Older publishable", createdAt: new Date("2026-07-30T03:00:00.000Z") },
    { id: `final-unpublished-${nonce}`, visibility: "unpublished", title: `unpublished-secret-${nonce}`, createdAt: new Date("2026-07-30T02:00:00.000Z") },
    { id: `final-free-${nonce}`, visibility: "free", title: "Free publishable", createdAt: new Date("2026-07-30T01:00:00.000Z") },
    { id: `final-members-${nonce}`, visibility: "members", title: "Members publishable", createdAt: new Date("2026-07-30T00:00:00.000Z") },
    { id: `final-pending-${nonce}`, visibility: "pending", title: `pending-secret-${nonce}`, createdAt: new Date("2026-07-29T23:00:00.000Z") },
    { id: `final-removed-${nonce}`, visibility: "removed", title: `removed-secret-${nonce}`, createdAt: new Date("2026-07-29T22:00:00.000Z") }
  ];
  const relationPosts = posts.slice(0, 4);
  const relationTimes = [
    new Date("2026-07-30T09:00:00.000Z"),
    new Date("2026-07-30T08:00:00.000Z"),
    new Date("2026-07-30T07:00:00.000Z"),
    new Date("2026-07-30T06:00:00.000Z")
  ];
  const hiddenMediaId = `final-hidden-media-${nonce}`;
  const relationIds = {
    bookmarks: relationPosts.map((_, index) => `final-bookmark-${index}-${nonce}`),
    likes: relationPosts.map((_, index) => `final-like-${index}-${nonce}`),
    history: relationPosts.map((_, index) => `final-history-${index}-${nonce}`),
    entitlements: relationPosts.map((_, index) => `final-entitlement-${index}-${nonce}`)
  };

  try {
    await prisma.user.create({
      data: {
        id: creatorId,
        name: "Canonical Database Creator",
        handle,
        avatar: "C",
        email: `${handle}@e2e.purehub.local`,
        role: "creator",
        creatorStatus: "approved",
        status: "active"
      }
    });
    await prisma.creatorProfile.create({
      data: {
        id: `${creatorId}-profile`,
        userId: creatorId,
        bio: "Final publishability fixture.",
        category: "Test",
        cover: "cover-1",
        verified: true
      }
    });
    await prisma.post.createMany({
      data: posts.map((post) => ({
        ...post,
        creatorId,
        excerpt: `${post.title} excerpt`,
        content: `${post.title} full-content-${nonce}`,
        cover: "cover-1",
        category: "Test",
        tags: [],
        comments: [],
        createdLabel: "fixture",
        saleMode: "single_plus_subscription",
        price: post.visibility === "free" ? null : 28
      }))
    });
    await prisma.mediaAsset.create({
      data: {
        id: hiddenMediaId,
        postId: posts[1].id,
        src: `/private-hidden-${nonce}.jpg`,
        alt: `hidden-media-secret-${nonce}`,
        width: 640,
        height: 480,
        order: 0,
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: 128,
        status: "ready",
        visibility: "purchase"
      }
    });
    await prisma.bookmark.createMany({
      data: relationPosts.map((post, index) => ({ id: relationIds.bookmarks[index], userId: viewerId, postId: post.id, createdAt: relationTimes[index] }))
    });
    await prisma.postLike.createMany({
      data: relationPosts.map((post, index) => ({ id: relationIds.likes[index], userId: viewerId, postId: post.id, createdAt: relationTimes[index] }))
    });
    await prisma.postViewHistory.createMany({
      data: relationPosts.map((post, index) => ({
        id: relationIds.history[index],
        userId: viewerId,
        postId: post.id,
        firstViewedAt: relationTimes[index],
        lastViewedAt: relationTimes[index]
      }))
    });
    await prisma.entitlement.createMany({
      data: relationPosts.map((post, index) => ({
        id: relationIds.entitlements[index],
        userId: viewerId,
        postId: post.id,
        source: "purchase",
        createdAt: relationTimes[index]
      }))
    });
    await prisma.subscription.create({
      data: {
        id: `final-subscription-${nonce}`,
        userId: viewerId,
        creatorId,
        planId: `final-plan-${nonce}`,
        status: "active",
        startedAt: relationTimes[0]
      }
    });

    const feed = await request.get("/api/posts");
    expect(feed.ok(), await feed.text()).toBeTruthy();
    const feedText = await feed.text();
    const creatorResponse = await request.get(`/api/creators/${handle}`);
    expect(creatorResponse.ok(), await creatorResponse.text()).toBeTruthy();
    const creatorText = await creatorResponse.text();
    for (const moderated of posts.filter((post) => !["free", "members", "purchase"].includes(post.visibility))) {
      expect(feedText).not.toContain(moderated.id);
      expect(feedText).not.toContain(moderated.title);
      expect(creatorText).not.toContain(moderated.id);
      expect(creatorText).not.toContain(moderated.title);
      const detail = await request.get(`/api/posts/${moderated.id}`);
      expect(detail.status(), await detail.text()).toBe(404);
    }
    expect(feedText).not.toContain(`hidden-media-secret-${nonce}`);
    expect(creatorText).not.toContain(`hidden-media-secret-${nonce}`);
    const media = await request.get(`/api/media/${hiddenMediaId}/access`);
    expect(media.status(), await media.text()).toBe(403);
    expect(await media.text()).not.toContain(`/private-hidden-${nonce}.jpg`);

    await moderateAdminContent(
      { actorUserId: "admin-demo", role: "super_admin" },
      posts[4].id,
      { action: "hide" }
    );
    await moderateAdminContent(
      { actorUserId: "admin-demo", role: "super_admin" },
      posts[5].id,
      { action: "unpublish" }
    );
    const afterModerationFeed = await (await request.get("/api/posts")).text();
    const afterModerationCreator = await (await request.get(`/api/creators/${handle}`)).text();
    for (const moderatedId of [posts[4].id, posts[5].id]) {
      expect(afterModerationFeed).not.toContain(moderatedId);
      expect(afterModerationCreator).not.toContain(moderatedId);
      expect((await request.get(`/api/posts/${moderatedId}`)).status()).toBe(404);
    }

    const resources = [
      { path: "/api/me/favorites?type=posts", scope: "favorite-posts", relationIds: relationIds.bookmarks },
      { path: "/api/me/likes", scope: "likes", relationIds: relationIds.likes },
      { path: "/api/me/history", scope: "history", relationIds: relationIds.history },
      { path: "/api/me/unlocked", scope: "unlocked", relationIds: relationIds.entitlements }
    ] as const;
    for (const resource of resources) {
      const firstResponse = await request.get(`${resource.path}${resource.path.includes("?") ? "&" : "?"}limit=1`);
      expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
      const first = await firstResponse.json() as {
        items: Array<{ post: { id: string }; creator: { id: string; handle: string }; occurredAt: string }>;
        nextCursor: string | null;
      };
      expect(first.items).toEqual([expect.objectContaining({
        post: expect.objectContaining({ id: posts[0].id }),
        creator: expect.objectContaining({ id: creatorId, handle }),
        occurredAt: relationTimes[0].toISOString()
      })]);
      expect(first.nextCursor).not.toBeNull();
      const parsed = parseAccountCursor(first.nextCursor!, resource.scope);
      expect(parsed.occurredAt).toBe(relationTimes[0].toISOString());
      expect(parsed.id).toContain(resource.relationIds[0]);

      const separator = resource.path.includes("?") ? "&" : "?";
      const secondResponse = await request.get(`${resource.path}${separator}limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
      const second = await secondResponse.json() as { items: Array<{ post: { id: string } }>; nextCursor: string | null };
      expect(second.items.map((item) => item.post.id)).toEqual([posts[2].id]);
      expect(JSON.stringify(second.items)).not.toContain(posts[1].id);
      expect(JSON.stringify(second.items)).not.toContain(posts[3].id);
    }
  } finally {
    await prisma.channelJob.deleteMany({ where: { entityType: "post", entityId: { in: posts.map((post) => post.id) } } });
    await prisma.auditLog.deleteMany({ where: { targetType: "post", targetId: { in: posts.map((post) => post.id) } } });
    await prisma.subscription.deleteMany({ where: { userId: viewerId, creatorId } });
    await prisma.entitlement.deleteMany({ where: { userId: viewerId, postId: { in: posts.map((post) => post.id) } } });
    await prisma.postViewHistory.deleteMany({ where: { userId: viewerId, postId: { in: posts.map((post) => post.id) } } });
    await prisma.postLike.deleteMany({ where: { userId: viewerId, postId: { in: posts.map((post) => post.id) } } });
    await prisma.bookmark.deleteMany({ where: { userId: viewerId, postId: { in: posts.map((post) => post.id) } } });
    await prisma.mediaAsset.deleteMany({ where: { id: hiddenMediaId } });
    await prisma.post.deleteMany({ where: { id: { in: posts.map((post) => post.id) } } });
    await prisma.creatorProfile.deleteMany({ where: { userId: creatorId } });
    await prisma.user.deleteMany({ where: { id: creatorId } });
  }
});
