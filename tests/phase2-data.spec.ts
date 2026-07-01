import { expect, test } from "@playwright/test";

test("phase 2 feed, detail, creator, and pricing APIs are available", async ({ request }) => {
  const feed = await request.get("/api/feed");
  expect(feed.ok()).toBeTruthy();
  const feedBody = await feed.json();
  expect(feedBody.posts.length).toBeGreaterThan(0);

  const postId = feedBody.posts[0].id;
  const post = await request.get(`/api/posts/${postId}`);
  expect(post.ok()).toBeTruthy();
  await expect(post).toBeOK();
  const postBody = await post.json();
  expect(postBody.post.id).toBe(postId);

  const creator = await request.get("/api/creators/yuki");
  expect(creator.ok()).toBeTruthy();
  const creatorBody = await creator.json();
  expect(creatorBody.creator.handle).toBe("yuki");

  const tiers = await request.get("/api/pricing/tiers?levelId=level-2&contentType=long_video&saleMode=long_video_single");
  expect(tiers.ok()).toBeTruthy();
  const tiersBody = await tiers.json();
  expect(tiersBody.tiers.map((tier: { price: number }) => tier.price)).toEqual([50, 80, 120]);
});

test("phase 2 creator application and post APIs accept writable data", async ({ request }) => {
  const application = await request.post("/api/creator/applications", {
    data: {
      userId: `fan-${Date.now()}`,
      displayName: "Phase 2 Creator",
      category: "Cosplay",
      portfolio: "https://example.com/portfolio",
      contact: "phase2@example.com",
      note: "Phase 2 e2e application smoke"
    }
  });
  expect(application.ok()).toBeTruthy();
  const applicationBody = await application.json();
  expect(applicationBody.application.status).toBe("pending");

  const post = await request.post("/api/posts", {
    data: {
      creatorId: "c1",
      title: "Phase 2 API Post",
      excerpt: "Created through the Phase 2 post API.",
      content: "This post verifies that the Phase 2 post API can accept new creator work and keep the response shape stable.",
      category: "Cosplay",
      contentType: "long_video",
      saleMode: "long_video_single",
      visibility: "purchase",
      price: 80
    }
  });
  expect(post.ok()).toBeTruthy();
  const postBody = await post.json();
  expect(postBody.post.title).toBe("Phase 2 API Post");
  expect(postBody.post.price).toBe(80);
});
