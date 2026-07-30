import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type TestInfo
} from "@playwright/test";
import {
  assertNoAccountIdentityOverrideHeaders,
  deleteExpiredPostViews,
  listPostHistory,
  recordPostView
} from "../lib/account/repository";
import { parseAccountCursor } from "../lib/account/cursor";
import { prisma } from "../lib/prisma";
import { hasDatabase, registerFan, signIn } from "./auth-helpers";

async function requireAccountDatabase(
  request: APIRequestContext,
  testInfo: TestInfo
) {
  test.skip(testInfo.project.name === "mobile", "Account API database coverage runs once.");
  test.skip(!(await hasDatabase(request)), "Account APIs require PostgreSQL.");
}

test("account lists require authentication and reject identity headers first", async () => {
  const anonymous = await playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001"
  });
  const paths = [
    "/api/me/likes",
    "/api/me/following",
    "/api/me/unlocked",
    "/api/me/orders"
  ];

  try {
    for (const path of paths) {
      expect((await anonymous.get(path)).status()).toBe(401);
      for (const header of ["x-user-id", "x-user-role", "x-admin-role"]) {
        expect((await anonymous.get(path, {
          headers: { [header]: "attacker-controlled" }
        })).status()).toBe(400);
      }
    }
  } finally {
    await anonymous.dispose();
  }
});

test("account lists are session-owned, access-aware, and payment-safe", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const fan = await registerFan(request, "account-lists");
  await signIn(request, fan.email);
  const fanId = (await (await request.get("/api/me")).json()).user.id as string;
  const nonce = Date.now().toString(36);
  const activeCreatorId = `account-creator-active-${nonce}`;
  const expiredCreatorId = `account-creator-expired-${nonce}`;
  const creatorIds = [activeCreatorId, expiredCreatorId];
  const likedPost = {
    id: `account-liked-${nonce}`,
    creatorId: activeCreatorId,
    title: "Liked account post",
    visibility: "free",
    createdAt: new Date("2026-07-30T01:00:00.000Z")
  };
  const purchasedPost = {
    id: `account-purchased-${nonce}`,
    creatorId: activeCreatorId,
    title: "Purchased account post",
    visibility: "purchase",
    saleMode: "single_plus_subscription",
    price: 28,
    createdAt: new Date("2026-07-30T07:00:00.000Z")
  };
  const subscriptionPurchasePost = {
    id: `account-subscription-purchase-${nonce}`,
    creatorId: activeCreatorId,
    title: "Subscriber purchase-visible post",
    visibility: "purchase",
    saleMode: "single_plus_subscription",
    price: 28,
    createdAt: new Date("2026-07-30T07:00:00.000Z")
  };
  const activeMemberPost = {
    id: `account-active-member-${nonce}`,
    creatorId: activeCreatorId,
    title: "Active member post",
    visibility: "members",
    createdAt: new Date("2026-07-30T06:00:00.000Z")
  };
  const expiredMemberPost = {
    id: `account-expired-member-${nonce}`,
    creatorId: expiredCreatorId,
    title: "Expired member post",
    visibility: "members",
    createdAt: new Date("2026-07-30T04:00:00.000Z")
  };
  const postIds = [
    likedPost.id,
    purchasedPost.id,
    subscriptionPurchasePost.id,
    activeMemberPost.id,
    expiredMemberPost.id
  ];
  const ownOrderId = `account-order-own-${nonce}`;
  const otherOrderId = `account-order-other-${nonce}`;
  const paymentIntentId = `account-intent-${nonce}`;
  const channelMembershipId = `account-channel-member-${nonce}`;
  const channelPostId = `account-channel-post-${nonce}`;
  const purchaseEntitlementId = `account-entitlement-${nonce}`;
  const activeSubscriptionId = `account-sub-active-${nonce}`;
  const expiredSubscriptionId = `account-sub-expired-${nonce}`;

  try {
    await prisma.user.createMany({
      data: [
        {
          id: activeCreatorId,
          name: "Account Active Creator",
          handle: `account-active-${nonce}`,
          avatar: "A",
          email: `account-active-${nonce}@e2e.purehub.local`,
          role: "creator",
          creatorStatus: "approved"
        },
        {
          id: expiredCreatorId,
          name: "Account Expired Creator",
          handle: `account-expired-${nonce}`,
          avatar: "E",
          email: `account-expired-${nonce}@e2e.purehub.local`,
          role: "creator",
          creatorStatus: "approved"
        }
      ]
    });
    await prisma.creatorProfile.createMany({
      data: [
        {
          id: `${activeCreatorId}-profile`,
          userId: activeCreatorId,
          bio: "Isolated active account-list fixture creator.",
          category: "Account fixtures",
          cover: "account-active-cover",
          verified: true
        },
        {
          id: `${expiredCreatorId}-profile`,
          userId: expiredCreatorId,
          bio: "Isolated expired account-list fixture creator.",
          category: "Account fixtures",
          cover: "account-expired-cover",
          verified: true
        }
      ]
    });
    await prisma.post.createMany({
      data: [
        likedPost,
        purchasedPost,
        subscriptionPurchasePost,
        activeMemberPost,
        expiredMemberPost
      ].map((post) => ({
        ...post,
        excerpt: `${post.title} excerpt`,
        content: `${post.title} content`,
        cover: "/images/post-placeholder.svg",
        category: "生活",
        tags: [],
        comments: [],
        createdLabel: "刚刚"
      }))
    });
    await prisma.postLike.create({
      data: {
        id: `account-like-${nonce}`,
        userId: fanId,
        postId: likedPost.id,
        createdAt: new Date("2026-07-30T05:00:00.000Z")
      }
    });
    await prisma.follow.create({
      data: {
        id: `account-follow-${nonce}`,
        userId: fanId,
        creatorId: activeCreatorId,
        createdAt: new Date("2026-07-30T06:00:00.000Z")
      }
    });
    await prisma.entitlement.create({
      data: {
        id: purchaseEntitlementId,
        userId: fanId,
        postId: purchasedPost.id,
        source: "purchase",
        createdAt: new Date("2026-07-30T07:00:00.000Z")
      }
    });
    await prisma.subscription.createMany({
      data: [
        {
          id: activeSubscriptionId,
          userId: fanId,
          creatorId: activeCreatorId,
          planId: `account-plan-active-${nonce}`,
          status: "active",
          startedAt: new Date("2026-07-30T08:00:00.000Z")
        },
        {
          id: expiredSubscriptionId,
          userId: fanId,
          creatorId: expiredCreatorId,
          planId: `account-plan-expired-${nonce}`,
          status: "expired",
          startedAt: new Date("2026-07-30T09:00:00.000Z")
        }
      ]
    });
    await prisma.channelMembership.create({
      data: {
        id: channelMembershipId,
        channelId: "channel-purehub-official",
        userId: fanId,
        role: "member",
        status: "active"
      }
    });
    await prisma.channelPost.create({
      data: {
        id: channelPostId,
        channelId: "channel-purehub-official",
        postId: expiredMemberPost.id,
        source: "manual",
        status: "published",
        addedByUserId: expiredCreatorId
      }
    });
    await prisma.order.createMany({
      data: [
        {
          id: ownOrderId,
          buyerUserId: fanId,
          creatorUserId: activeCreatorId,
          kind: "post_unlock",
          itemId: purchasedPost.id,
          amount: 28,
          currency: "CNY",
          status: "fulfilled",
          provider: "card",
          createdAt: new Date("2026-07-30T10:00:00.000Z"),
          paidAt: new Date("2026-07-30T10:01:00.000Z"),
          metadata: {
            postTitle: purchasedPost.title,
            clientSecret: "metadata-must-not-leak",
            manualInstructions: { message: "metadata-must-not-leak" },
            providerPayload: { credential: "metadata-must-not-leak" }
          }
        },
        {
          id: otherOrderId,
          buyerUserId: "c1",
          creatorUserId: expiredCreatorId,
          kind: "subscription",
          itemId: `account-other-plan-${nonce}`,
          amount: 48,
          currency: "CNY",
          status: "pending",
          provider: "card",
          createdAt: new Date("2026-07-30T11:00:00.000Z"),
          metadata: { planName: "Another buyer plan" }
        }
      ]
    });
    await prisma.paymentIntent.create({
      data: {
        id: paymentIntentId,
        orderId: ownOrderId,
        provider: "card",
        status: "requires_confirmation",
        amount: 28,
        currency: "CNY",
        clientSecret: "intent-must-not-leak",
        manualInstructions: { message: "intent-must-not-leak" },
        metadata: { providerPayload: "intent-must-not-leak" }
      }
    });

    for (const path of ["/api/me/likes", "/api/me/following", "/api/me/unlocked", "/api/me/orders"]) {
      expect((await request.get(`${path}?userId=c1`)).status()).toBe(400);
      for (const header of ["x-user-id", "x-user-role", "x-admin-role"]) {
        expect((await request.get(path, { headers: { [header]: "c1" } })).status()).toBe(400);
      }
    }

    const meLikes = await request.get("/api/me/likes");
    expect(meLikes.ok(), await meLikes.text()).toBeTruthy();
    expect((await meLikes.json()).items).toEqual([
      expect.objectContaining({
        occurredAt: "2026-07-30T05:00:00.000Z",
        post: expect.objectContaining({ id: likedPost.id, liked: true }),
        creator: expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          handle: expect.any(String),
          avatar: expect.any(String)
        })
      })
    ]);

    const meFollowing = await request.get("/api/me/following");
    expect(meFollowing.ok(), await meFollowing.text()).toBeTruthy();
    expect((await meFollowing.json()).items).toEqual([
      expect.objectContaining({
        occurredAt: "2026-07-30T06:00:00.000Z",
        creator: expect.objectContaining({
          id: activeCreatorId,
          handle: expect.any(String),
          bio: expect.any(String),
          category: expect.any(String)
        })
      })
    ]);

    const meUnlocked = await request.get("/api/me/unlocked");
    expect(meUnlocked.ok(), await meUnlocked.text()).toBeTruthy();
    const unlockedItems = (await meUnlocked.json()).items as Array<{
      source: "purchase" | "subscription";
      post: { id: string; hasAccess: boolean };
    }>;
    expect(unlockedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        post: expect.objectContaining({ id: purchasedPost.id, hasAccess: true }),
        source: "purchase"
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: subscriptionPurchasePost.id, hasAccess: true }),
        source: "subscription"
      }),
      expect.objectContaining({
        post: expect.objectContaining({ id: activeMemberPost.id, hasAccess: true }),
        source: "subscription"
      })
    ]));
    expect(unlockedItems.filter((item) => item.post.id === purchasedPost.id)).toEqual([
      expect.objectContaining({ source: "purchase" })
    ]);
    expect(unlockedItems.map((item) => item.post.id)).not.toContain(likedPost.id);
    expect(unlockedItems.map((item) => item.post.id)).not.toContain(expiredMemberPost.id);
    const firstUnlockedPageResponse = await request.get("/api/me/unlocked?limit=1");
    expect(firstUnlockedPageResponse.ok(), await firstUnlockedPageResponse.text()).toBeTruthy();
    const firstUnlockedPage = await firstUnlockedPageResponse.json() as {
      items: Array<{ source: string; post: { id: string } }>;
      nextCursor: string | null;
    };
    expect(firstUnlockedPage.items).toEqual([
      expect.objectContaining({
        source: "purchase",
        post: expect.objectContaining({ id: purchasedPost.id })
      })
    ]);
    expect(firstUnlockedPage.nextCursor).not.toBeNull();
    const secondUnlockedPageResponse = await request.get(
      `/api/me/unlocked?limit=1&cursor=${encodeURIComponent(firstUnlockedPage.nextCursor!)}`
    );
    expect(secondUnlockedPageResponse.ok(), await secondUnlockedPageResponse.text()).toBeTruthy();
    const secondUnlockedPage = await secondUnlockedPageResponse.json() as {
      items: Array<{ source: string; post: { id: string } }>;
      nextCursor: string | null;
    };
    expect(secondUnlockedPage.items).toEqual([
      expect.objectContaining({
        source: "subscription",
        post: expect.objectContaining({ id: subscriptionPurchasePost.id })
      })
    ]);
    expect(secondUnlockedPage.nextCursor).not.toBeNull();
    const thirdUnlockedPageResponse = await request.get(
      `/api/me/unlocked?limit=1&cursor=${encodeURIComponent(secondUnlockedPage.nextCursor!)}`
    );
    expect(thirdUnlockedPageResponse.ok(), await thirdUnlockedPageResponse.text()).toBeTruthy();
    const thirdUnlockedPage = await thirdUnlockedPageResponse.json() as {
      items: Array<{ source: string; post: { id: string } }>;
      nextCursor: string | null;
    };
    expect(thirdUnlockedPage.items).toEqual([
      expect.objectContaining({
        source: "subscription",
        post: expect.objectContaining({ id: activeMemberPost.id })
      })
    ]);
    expect(thirdUnlockedPage.nextCursor).toBeNull();

    const meOrders = await request.get("/api/me/orders");
    expect(meOrders.ok(), await meOrders.text()).toBeTruthy();
    const orders = (await meOrders.json()).items as Array<Record<string, unknown>>;
    expect(orders).toEqual([
      expect.objectContaining({
        id: ownOrderId,
        itemId: purchasedPost.id,
        itemLabel: purchasedPost.title,
        creator: expect.objectContaining({ id: activeCreatorId })
      })
    ]);
    expect(orders.map((order) => order.id)).not.toContain(otherOrderId);
    const serializedOrders = JSON.stringify(orders);
    for (const forbidden of [
      "clientSecret",
      "manualInstructions",
      "providerPayload",
      "intent-must-not-leak",
      "metadata-must-not-leak"
    ]) {
      expect(serializedOrders).not.toContain(forbidden);
    }
    expect(orders[0]).not.toHaveProperty("metadata");
    expect(orders[0]).not.toHaveProperty("paymentIntents");
    expect(orders[0]).not.toHaveProperty("paymentTransactions");
  } finally {
    await prisma.paymentIntent.deleteMany({ where: { id: paymentIntentId } });
    await prisma.entitlement.deleteMany({ where: { id: purchaseEntitlementId } });
    await prisma.subscription.deleteMany({
      where: { id: { in: [activeSubscriptionId, expiredSubscriptionId] } }
    });
    await prisma.order.deleteMany({ where: { id: { in: [ownOrderId, otherOrderId] } } });
    await prisma.channelPost.deleteMany({ where: { id: channelPostId } });
    await prisma.channelMembership.deleteMany({ where: { id: channelMembershipId } });
    await prisma.postLike.deleteMany({ where: { userId: fanId, postId: likedPost.id } });
    await prisma.follow.deleteMany({ where: { userId: fanId, creatorId: activeCreatorId } });
    await prisma.post.deleteMany({ where: { id: { in: postIds } } });
    await prisma.creatorProfile.deleteMany({ where: { userId: { in: creatorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: creatorIds } } });
  }
});

test("favorites require authentication", async () => {
  const anonymous = await playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001"
  });

  try {
    expect((await anonymous.get("/api/me/favorites?type=posts")).status()).toBe(401);
    expect((await anonymous.post("/api/channels/purehub-official/bookmark")).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test("favorites reject invalid and identity query parameters", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const fan = await registerFan(request, "account-favorite-query");
  await signIn(request, fan.email);

  expect((await request.get("/api/me/favorites")).status()).toBe(400);
  expect((await request.get("/api/me/favorites?type=invalid")).status()).toBe(400);
  expect((await request.get("/api/me/favorites?type=posts&cursor=not-a-cursor")).status()).toBe(400);
  expect((await request.get("/api/me/favorites?type=posts&type=channels")).status()).toBe(400);
  expect((await request.get("/api/me/favorites?type=posts&limit=0")).status()).toBe(400);
  expect((await request.get("/api/me/favorites?type=posts&limit=51")).status()).toBe(400);
  expect((await request.get("/api/me/favorites?type=posts&userId=c1")).status()).toBe(400);
});

test("favorites are session-owned and channel bookmarks grant no access", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const hiddenChannel = {
    id: `account-hidden-${Date.now()}`,
    slug: `account-hidden-${Date.now()}`,
    name: "Account hidden channel",
    description: "A hidden channel used to verify bookmark ACLs.",
    kind: "creator",
    visibility: "private",
    discoverability: "hidden",
    status: "active",
    ownerUserId: "c1",
    createdByUserId: "c1",
    memberPostPolicy: "approval_required"
  };
  const fan = await registerFan(request, "account-favorites");
  await signIn(request, fan.email);
  const fanId = (await (await request.get("/api/me")).json()).user.id as string;
  await prisma.channel.create({ data: hiddenChannel });

  try {
    expect((await request.post(`/api/posts/post-1/bookmark`)).ok()).toBeTruthy();
    expect((await request.post(`/api/posts/post-1/bookmark`)).ok()).toBeTruthy();

    const postFavorites = await request.get("/api/me/favorites?type=posts", {
      headers: { "x-user-id": "c1" }
    });
    expect(postFavorites.ok(), await postFavorites.text()).toBeTruthy();
    expect(await postFavorites.json()).toEqual({
      items: [
        expect.objectContaining({
          id: "post-1",
          creatorId: "c1",
          bookmarked: true
        })
      ],
      nextCursor: null
    });

    expect((await request.post(`/api/channels/${hiddenChannel.slug}/bookmark`)).status()).toBe(404);
    expect((await request.post("/api/channels/purehub-official/bookmark", {
      data: { userId: "c1" }
    })).status()).toBe(400);
    expect((await request.post("/api/channels/purehub-official/bookmark?userId=c1")).status()).toBe(400);

    const beforeDetail = await request.get("/api/channels/purehub-official");
    expect(beforeDetail.ok(), await beforeDetail.text()).toBeTruthy();
    const beforeAccess = (await beforeDetail.json()).channel.access;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.post("/api/channels/purehub-official/bookmark", {
        headers: { "x-user-id": "c1" }
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      expect(await response.json()).toEqual({ bookmarked: true });
    }

    expect(await prisma.channelBookmark.findUnique({
      where: { userId_channelId: { userId: fanId, channelId: "channel-purehub-official" } }
    })).not.toBeNull();
    expect(await prisma.channelBookmark.findUnique({
      where: { userId_channelId: { userId: "c1", channelId: "channel-purehub-official" } }
    })).toBeNull();
    expect(await prisma.channelMembership.findUnique({
      where: { channelId_userId: { channelId: "channel-purehub-official", userId: fanId } }
    })).toBeNull();

    const channelFavorites = await request.get("/api/me/favorites?type=channels", {
      headers: { "x-user-id": "c1" }
    });
    expect(channelFavorites.ok(), await channelFavorites.text()).toBeTruthy();
    expect(await channelFavorites.json()).toEqual({
      items: [
        expect.objectContaining({
          channel: expect.objectContaining({
            id: "channel-purehub-official",
            slug: "purehub-official",
            bookmarked: true
          }),
          occurredAt: expect.any(String)
        })
      ],
      nextCursor: null
    });

    const bookmarkedDetail = await request.get("/api/channels/purehub-official");
    expect(bookmarkedDetail.ok(), await bookmarkedDetail.text()).toBeTruthy();
    expect((await bookmarkedDetail.json()).channel).toEqual(expect.objectContaining({
      bookmarked: true,
      access: beforeAccess
    }));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.delete("/api/channels/purehub-official/bookmark");
      expect(response.ok(), await response.text()).toBeTruthy();
      expect(await response.json()).toEqual({ bookmarked: false });
    }
    expect(await prisma.channelBookmark.findUnique({
      where: { userId_channelId: { userId: fanId, channelId: "channel-purehub-official" } }
    })).toBeNull();
  } finally {
    await prisma.channel.deleteMany({ where: { id: hiddenChannel.id } });
    await prisma.bookmark.deleteMany({ where: { userId: fanId, postId: "post-1" } });
    await prisma.channelBookmark.deleteMany({ where: { userId: fanId } });
  }
});

test("favorites paginate only ACL-visible channel bookmarks", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const fan = await registerFan(request, "account-favorite-pages");
  await signIn(request, fan.email);
  const fanId = (await (await request.get("/api/me")).json()).user.id as string;
  const nonce = Date.now().toString(36);
  const channels = [
    { id: `account-page-new-${nonce}`, slug: `account-page-new-${nonce}`, name: "Newest visible favorite" },
    { id: `account-page-hidden-${nonce}`, slug: `account-page-hidden-${nonce}`, name: "Later hidden favorite" },
    { id: `account-page-middle-${nonce}`, slug: `account-page-middle-${nonce}`, name: "Middle visible favorite" },
    { id: `account-page-old-${nonce}`, slug: `account-page-old-${nonce}`, name: "Oldest visible favorite" }
  ];
  const bookmarkRows = [
    { id: `account-bookmark-new-${nonce}`, channelId: channels[0].id, createdAt: new Date("2026-07-30T04:00:00.000Z") },
    { id: `account-bookmark-hidden-${nonce}`, channelId: channels[1].id, createdAt: new Date("2026-07-30T03:00:00.000Z") },
    { id: `account-bookmark-middle-${nonce}`, channelId: channels[2].id, createdAt: new Date("2026-07-30T02:00:00.000Z") },
    { id: `account-bookmark-old-${nonce}`, channelId: channels[3].id, createdAt: new Date("2026-07-30T01:00:00.000Z") }
  ];

  try {
    await prisma.channel.createMany({
      data: channels.map((channel) => ({
        ...channel,
        description: "Channel favorite pagination fixture.",
        kind: "creator",
        visibility: "public",
        discoverability: "discoverable",
        status: "active",
        ownerUserId: "c1",
        createdByUserId: "c1",
        memberPostPolicy: "approval_required"
      }))
    });
    await prisma.channelBookmark.createMany({
      data: bookmarkRows.map((row) => ({ ...row, userId: fanId }))
    });
    await prisma.channel.update({
      where: { id: channels[1].id },
      data: { visibility: "private", discoverability: "hidden" }
    });

    const firstResponse = await request.get("/api/me/favorites?type=channels&limit=2");
    expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
    const first = await firstResponse.json() as {
      items: Array<{ channel: { slug: string }; occurredAt: string }>;
      nextCursor: string | null;
    };
    expect(first.items.map((item) => item.channel.slug)).toEqual([
      channels[0].slug,
      channels[2].slug
    ]);
    expect(first.items.map((item) => item.occurredAt)).toEqual([
      "2026-07-30T04:00:00.000Z",
      "2026-07-30T02:00:00.000Z"
    ]);
    expect(first.nextCursor).not.toBeNull();
    expect(parseAccountCursor(first.nextCursor!, "favorite-channels")).toEqual({
      scope: "favorite-channels",
      occurredAt: "2026-07-30T02:00:00.000Z",
      id: bookmarkRows[2].id
    });

    const secondResponse = await request.get(
      `/api/me/favorites?type=channels&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`
    );
    expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
    const second = await secondResponse.json() as {
      items: Array<{ channel: { slug: string }; occurredAt: string }>;
      nextCursor: string | null;
    };
    expect(second.items.map((item) => item.channel.slug)).toEqual([channels[3].slug]);
    expect(second.items.map((item) => item.occurredAt)).toEqual(["2026-07-30T01:00:00.000Z"]);
    expect(second.nextCursor).toBeNull();
  } finally {
    await prisma.channelBookmark.deleteMany({
      where: { id: { in: bookmarkRows.map((row) => row.id) } }
    });
    await prisma.channel.deleteMany({
      where: { id: { in: channels.map((channel) => channel.id) } }
    });
  }
});

test("view history requires authentication", async () => {
  const anonymous = await playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001"
  });

  try {
    expect((await anonymous.post("/api/posts/post-1/view")).status()).toBe(401);
    expect((await anonymous.get("/api/me/history")).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test("view history rejects known identity and role override headers", () => {
  for (const header of ["x-user-id", "x-user-role", "x-admin-role"]) {
    expect(() => assertNoAccountIdentityOverrideHeaders(new Request(
      "http://localhost/api/me/history",
      { headers: { [header]: "attacker-controlled" } }
    ))).toThrow(`This request does not accept the ${header} header.`);
  }
});

test("view history rejects identity headers before authentication lookup", async () => {
  const anonymous = await playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001"
  });

  try {
    expect((await anonymous.post("/api/posts/post-1/view", {
      headers: { "x-user-id": "c1" }
    })).status()).toBe(400);
    expect((await anonymous.get("/api/me/history", {
      headers: { "x-admin-role": "super_admin" }
    })).status()).toBe(400);
  } finally {
    await anonymous.dispose();
  }
});

test("view history preserves the first timestamp and advances the last timestamp", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const fan = await registerFan(request, "account-view-upsert");
  await signIn(request, fan.email);
  const fanId = (await (await request.get("/api/me")).json()).user.id as string;
  const first = new Date("2026-04-30T00:00:00.000Z");
  const second = new Date("2026-07-30T00:00:00.000Z");

  try {
    await recordPostView(fanId, "post-1", first);
    await recordPostView(fanId, "post-1", second);
    const row = await prisma.postViewHistory.findUniqueOrThrow({
      where: { userId_postId: { userId: fanId, postId: "post-1" } }
    });

    expect(row.firstViewedAt).toEqual(first);
    expect(row.lastViewedAt).toEqual(second);
    expect(await prisma.postViewHistory.count({
      where: { userId: fanId, postId: "post-1" }
    })).toBe(1);
  } finally {
    await prisma.postViewHistory.deleteMany({ where: { userId: fanId } });
  }
});

test("view history includes the exact ninety day boundary and deletes only older views", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const fan = await registerFan(request, "account-view-retention");
  await signIn(request, fan.email);
  const fanId = (await (await request.get("/api/me")).json()).user.id as string;
  const now = new Date("2026-07-30T00:00:00.000Z");
  const exactCutoff = new Date("2026-05-01T00:00:00.000Z");
  const expired = new Date("2026-04-30T23:59:59.999Z");
  const recent = new Date("2026-07-29T00:00:00.000Z");

  try {
    await recordPostView(fanId, "post-1", exactCutoff);
    await recordPostView(fanId, "post-2", expired);
    await recordPostView(fanId, "post-3", recent);

    const page = await listPostHistory(fanId, { limit: 1 }, now);
    expect(page.items).toEqual([
      expect.objectContaining({
        occurredAt: recent.toISOString(),
        post: expect.objectContaining({
          id: "post-3",
          media: expect.any(Array),
          bookmarked: expect.any(Boolean),
          liked: expect.any(Boolean),
          hasAccess: expect.any(Boolean)
        }),
        creator: expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          handle: expect.any(String),
          avatar: expect.any(String)
        })
      })
    ]);
    expect(page.nextCursor).not.toBeNull();
    const recentRow = await prisma.postViewHistory.findUniqueOrThrow({
      where: { userId_postId: { userId: fanId, postId: "post-3" } }
    });
    expect(parseAccountCursor(page.nextCursor!, "history")).toEqual({
      scope: "history",
      occurredAt: recent.toISOString(),
      id: recentRow.id
    });

    const all = await listPostHistory(fanId, {}, now);
    expect(all.items.map((item) => item.post.id)).toEqual(["post-3", "post-1"]);
    expect(all.items.map((item) => item.occurredAt)).toEqual([
      recent.toISOString(),
      exactCutoff.toISOString()
    ]);

    expect(await deleteExpiredPostViews(now)).toEqual({ deleted: 1 });
    expect(await prisma.postViewHistory.findUnique({
      where: { userId_postId: { userId: fanId, postId: "post-1" } }
    })).not.toBeNull();
    expect(await prisma.postViewHistory.findUnique({
      where: { userId_postId: { userId: fanId, postId: "post-2" } }
    })).toBeNull();
    expect(await deleteExpiredPostViews(now)).toEqual({ deleted: 0 });
  } finally {
    await prisma.postViewHistory.deleteMany({ where: { userId: fanId } });
  }
});

test("view history routes use only the session identity and reject missing posts", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const fan = await registerFan(request, "account-view-session");
  await signIn(request, fan.email);
  const fanId = (await (await request.get("/api/me")).json()).user.id as string;

  try {
    expect((await request.post("/api/posts/post-1/view", {
      data: { userId: "c1" }
    })).status()).toBe(400);
    expect(await prisma.postViewHistory.count({
      where: { userId: { in: [fanId, "c1"] }, postId: "post-1" }
    })).toBe(0);

    for (const header of ["x-user-id", "x-user-role", "x-admin-role"]) {
      const rejected = await request.post("/api/posts/post-1/view", {
        headers: { [header]: "c1" }
      });
      expect(rejected.status(), await rejected.text()).toBe(400);
    }
    expect(await prisma.postViewHistory.count({
      where: { userId: { in: [fanId, "c1"] }, postId: "post-1" }
    })).toBe(0);

    const recorded = await request.post("/api/posts/post-1/view");
    expect(recorded.status(), await recorded.text()).toBe(204);
    expect(await prisma.postViewHistory.findUnique({
      where: { userId_postId: { userId: fanId, postId: "post-1" } }
    })).not.toBeNull();
    expect(await prisma.postViewHistory.findUnique({
      where: { userId_postId: { userId: "c1", postId: "post-1" } }
    })).toBeNull();

    expect((await request.get("/api/me/history?userId=c1")).status()).toBe(400);
    for (const header of ["x-user-id", "x-user-role", "x-admin-role"]) {
      expect((await request.get("/api/me/history", {
        headers: { [header]: "c1" }
      })).status()).toBe(400);
    }

    const history = await request.get("/api/me/history");
    expect(history.ok(), await history.text()).toBeTruthy();
    expect((await history.json()).items.map((post: { id: string }) => post.id)).toEqual(["post-1"]);

    expect((await request.post(`/api/posts/missing-${Date.now()}/view`)).status()).toBe(404);
  } finally {
    await prisma.postViewHistory.deleteMany({ where: { userId: fanId } });
  }
});

test("view history records one request for one open post detail while the session refreshes", async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  await page.context().addCookies([{
    name: "purehub.session_token",
    value: "account-view-effect",
    url: baseURL
  }]);
  let sessionRequests = 0;
  let viewRequests = 0;
  await page.route("**/api/auth/get-session", (route) => {
    sessionRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: `account-view-session-${sessionRequests}`,
          userId: "account-view-user",
          expiresAt: "2027-07-30T00:00:00.000Z"
        },
        user: {
          id: "account-view-user",
          name: "Account View User",
          email: "account-view-user@purehub.local"
        }
      })
    });
  });
  await page.route("**/api/posts/post-1/view", (route) => {
    viewRequests += 1;
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/post/post-1");
  await expect.poll(() => viewRequests).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", {
    key: "better-auth.message",
    newValue: JSON.stringify({
      event: "session",
      data: { trigger: "test-session-refresh" },
      clientId: "account-view-test",
      timestamp: Math.floor(Date.now() / 1000)
    })
  })));
  await expect.poll(() => sessionRequests).toBeGreaterThan(1);
  await page.waitForTimeout(250);
  expect(viewRequests).toBe(1);
});

test("account maintenance accepts only its worker token and deletes expired view history", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const { POST: runAccountMaintenance } = await import(
    "../app/api/internal/account-maintenance/run/route"
  );
  const fan = await registerFan(request, "account-view-maintenance");
  await signIn(request, fan.email);
  const fanId = (await (await request.get("/api/me")).json()).user.id as string;
  const previousToken = process.env.WORKER_ACCESS_TOKEN;
  process.env.WORKER_ACCESS_TOKEN = "account-maintenance-test-token";

  try {
    await recordPostView(fanId, "post-1", new Date("2020-01-01T00:00:00.000Z"));

    const rejected = await runAccountMaintenance(new Request(
      "http://localhost/api/internal/account-maintenance/run",
      { method: "POST", headers: { "x-worker-token": "wrong-token" } }
    ));
    expect(rejected.status).toBe(401);
    expect(await prisma.postViewHistory.findUnique({
      where: { userId_postId: { userId: fanId, postId: "post-1" } }
    })).not.toBeNull();

    const accepted = await runAccountMaintenance(new Request(
      "http://localhost/api/internal/account-maintenance/run",
      { method: "POST", headers: { "x-worker-token": "account-maintenance-test-token" } }
    ));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ deleted: expect.any(Number) });
    expect(await prisma.postViewHistory.findUnique({
      where: { userId_postId: { userId: fanId, postId: "post-1" } }
    })).toBeNull();
  } finally {
    if (previousToken === undefined) {
      delete process.env.WORKER_ACCESS_TOKEN;
    } else {
      process.env.WORKER_ACCESS_TOKEN = previousToken;
    }
    await prisma.postViewHistory.deleteMany({ where: { userId: fanId } });
  }
});
