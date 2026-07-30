import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type TestInfo
} from "@playwright/test";
import { prisma } from "../lib/prisma";
import { hasDatabase, registerFan, signIn } from "./auth-helpers";

async function requireAccountDatabase(
  request: APIRequestContext,
  testInfo: TestInfo
) {
  test.skip(testInfo.project.name === "mobile", "Account API database coverage runs once.");
  test.skip(!(await hasDatabase(request)), "Account APIs require PostgreSQL.");
}

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
          id: "channel-purehub-official",
          slug: "purehub-official",
          bookmarked: true
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
