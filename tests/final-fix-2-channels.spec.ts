import { expect, request as playwrightRequest, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import { moderateAdminContent } from "../lib/admin-content-repository";
import { materializeChannel } from "../lib/channels/jobs";
import * as channelRepository from "../lib/channels/repository";
import { prisma } from "../lib/prisma";
import { hasDatabase, signInCreator, signInFan } from "./auth-helpers";

async function requireDatabase(request: APIRequestContext, testInfo: TestInfo) {
  test.skip(testInfo.project.name === "mobile", "Final channel database coverage runs once.");
  test.skip(!(await hasDatabase(request)), "Final channel hardening requires seeded PostgreSQL.");
}

function postData(input: {
  id: string;
  visibility: string;
  title: string;
  createdAt?: Date;
  category?: string;
}) {
  return {
    id: input.id,
    creatorId: "c2",
    title: input.title,
    excerpt: `${input.title} excerpt`,
    content: `${input.title} private body`,
    cover: "cover-1",
    category: input.category ?? "Final Channel Test",
    tags: [],
    visibility: input.visibility,
    saleMode: "single_plus_subscription",
    price: input.visibility === "free" ? null : 28,
    comments: [],
    createdLabel: "fixture",
    createdAt: input.createdAt ?? new Date()
  };
}

function channelData(input: { id: string; slug: string; visibility: "public" | "private" }) {
  return {
    id: input.id,
    slug: input.slug,
    name: `Final ${input.visibility} channel`,
    description: "Final channel visibility fixture.",
    kind: "creator",
    visibility: input.visibility,
    discoverability: "discoverable",
    status: "active",
    ownerUserId: "c2",
    createdByUserId: "c2",
    memberPostPolicy: "direct",
    reviewedByAdminId: "admin-demo",
    reviewedAt: new Date()
  };
}

async function cleanup(channelIds: string[], postIds: string[]) {
  await prisma.channelJob.deleteMany({ where: { entityType: "post", entityId: { in: postIds } } });
  await prisma.auditLog.deleteMany({ where: { targetType: "post", targetId: { in: postIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.post.deleteMany({ where: { id: { in: postIds } } });
}

test("channel feed query applies canonical post visibility before pagination", () => {
  const buildWhere = (channelRepository as typeof channelRepository & {
    channelPostFeedWhere?: (channelId: string, excludedPostIds: string[]) => unknown;
  }).channelPostFeedWhere;
  expect(buildWhere).toBeDefined();
  expect(buildWhere!("channel-1", ["excluded-post"])).toEqual({
    AND: [{
      channelId: "channel-1",
      status: "active",
      postId: { notIn: ["excluded-post"] },
      post: { is: { visibility: { in: ["free", "members", "purchase"] } } }
    }]
  });
});

test("channel feeds omit moderated rows before cursor pagination and restore retained curation on republish", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  const memberRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const nonce = Date.now().toString(36);
  const publicChannelId = `final-public-channel-${nonce}`;
  const privateChannelId = `final-private-channel-${nonce}`;
  const publicSlug = `final-public-${nonce}`;
  const privateSlug = `final-private-${nonce}`;
  const visiblePosts = Array.from({ length: 21 }, (_, index) => postData({
    id: `final-visible-${index}-${nonce}`,
    visibility: index % 3 === 0 ? "free" : index % 3 === 1 ? "members" : "purchase",
    title: `Visible channel post ${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 7, 3, 23 - index, 0, 0))
  }));
  const hiddenBetweenPages = postData({
    id: `final-page-hidden-${nonce}`,
    visibility: "hidden",
    title: `cursor-hidden-secret-${nonce}`,
    createdAt: new Date(Date.UTC(2026, 7, 3, 3, 30, 0))
  });
  const privateVisible = postData({ id: `final-private-visible-${nonce}`, visibility: "purchase", title: "Private member visible" });
  const privateHidden = postData({ id: `final-private-hidden-${nonce}`, visibility: "unpublished", title: `private-hidden-secret-${nonce}` });
  const postIds = [...visiblePosts, hiddenBetweenPages, privateVisible, privateHidden].map(({ id }) => id);

  try {
    await signInFan(memberRequest);
    await prisma.channel.create({
      data: {
        ...channelData({ id: publicChannelId, slug: publicSlug, visibility: "public" }),
        memberships: { create: { userId: "c2", role: "owner", status: "active", reviewedByUserId: "admin-demo", reviewedAt: new Date() } }
      }
    });
    await prisma.channel.create({
      data: {
        ...channelData({ id: privateChannelId, slug: privateSlug, visibility: "private" }),
        memberships: {
          create: [
            { userId: "c2", role: "owner", status: "active", reviewedByUserId: "admin-demo", reviewedAt: new Date() },
            { userId: "fan-demo", role: "member", status: "active", invitedByUserId: "c2", reviewedByUserId: "c2", reviewedAt: new Date() }
          ]
        }
      }
    });
    await prisma.post.createMany({ data: [...visiblePosts, hiddenBetweenPages, privateVisible, privateHidden] });
    await prisma.channelPost.createMany({
      data: [
        ...[...visiblePosts, hiddenBetweenPages].map((post) => ({
          id: `curated-${post.id}`,
          channelId: publicChannelId,
          postId: post.id,
          source: "manual",
          status: "active",
          addedByUserId: "c2",
          reviewedByUserId: "c2"
        })),
        ...[privateVisible, privateHidden].map((post) => ({
          id: `curated-${post.id}`,
          channelId: privateChannelId,
          postId: post.id,
          source: "manual",
          status: "active",
          addedByUserId: "c2",
          reviewedByUserId: "c2"
        }))
      ]
    });

    const firstResponse = await request.get(`/api/channels/${publicSlug}`);
    expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
    const first = (await firstResponse.json()).channel as { posts: Array<{ id: string; postId: string; post: { title: string } }>; nextCursor: string | null };
    expect(first.posts.map(({ postId }) => postId)).toEqual(visiblePosts.slice(0, 20).map(({ id }) => id));
    expect(JSON.stringify(first.posts)).not.toContain(hiddenBetweenPages.title);
    expect(first.nextCursor).not.toBeNull();

    const secondResponse = await request.get(`/api/channels/${publicSlug}?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
    const second = (await secondResponse.json()).channel as { posts: Array<{ postId: string; post: { title: string } }>; nextCursor: string | null };
    expect(second.posts.map(({ postId }) => postId)).toEqual([visiblePosts[20].id]);
    expect(JSON.stringify(second.posts)).not.toContain(hiddenBetweenPages.title);
    expect(second.nextCursor).toBeNull();

    const anonymousPrivate = await request.get(`/api/channels/${privateSlug}`);
    expect(anonymousPrivate.ok(), await anonymousPrivate.text()).toBeTruthy();
    expect(await anonymousPrivate.text()).not.toContain(privateHidden.title);
    const memberPrivate = await memberRequest.get(`/api/channels/${privateSlug}`);
    expect(memberPrivate.ok(), await memberPrivate.text()).toBeTruthy();
    const memberChannel = (await memberPrivate.json()).channel as { posts: Array<{ postId: string; post: { title: string } }> };
    expect(memberChannel.posts.map(({ postId }) => postId)).toEqual([privateVisible.id]);
    expect(JSON.stringify(memberChannel.posts)).not.toContain(privateHidden.title);

    const retained = first.posts[0];
    await moderateAdminContent({ actorUserId: "admin-demo", role: "super_admin" }, visiblePosts[0].id, { action: "hide" });
    const moderatedText = await (await request.get(`/api/channels/${publicSlug}`)).text();
    expect(moderatedText).not.toContain(visiblePosts[0].id);
    expect(moderatedText).not.toContain(visiblePosts[0].title);
    expect(await prisma.channelPost.findUniqueOrThrow({ where: { id: retained.id }, select: { status: true } })).toEqual({ status: "active" });

    await moderateAdminContent({ actorUserId: "admin-demo", role: "super_admin" }, visiblePosts[0].id, { action: "publish" });
    const republished = (await (await request.get(`/api/channels/${publicSlug}`)).json()).channel as { posts: Array<{ id: string; postId: string }> };
    expect(republished.posts).toContainEqual(expect.objectContaining({ id: retained.id, postId: visiblePosts[0].id }));
  } finally {
    await cleanup([publicChannelId, privateChannelId], postIds);
    await memberRequest.dispose();
  }
});

test("manual channel curation returns the same not-found response for every non-publishable post", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  const nonce = Date.now().toString(36);
  const channelId = `final-manual-channel-${nonce}`;
  const slug = `final-manual-${nonce}`;
  const posts = ["hidden", "unpublished", "pending", "removed"].map((visibility) => postData({
    id: `final-manual-${visibility}-${nonce}`,
    visibility,
    title: `manual-${visibility}-secret-${nonce}`
  }));

  try {
    await signInCreator(request, "chenmo");
    await prisma.channel.create({
      data: {
        ...channelData({ id: channelId, slug, visibility: "private" }),
        memberships: { create: { userId: "c2", role: "owner", status: "active", reviewedByUserId: "admin-demo", reviewedAt: new Date() } }
      }
    });
    await prisma.post.createMany({ data: posts });

    const bodies: string[] = [];
    const missingResponse = await request.post(`/api/dashboard/channels/${channelId}/posts`, {
      data: { postId: `final-manual-missing-${nonce}` }
    });
    expect(missingResponse.status(), await missingResponse.text()).toBe(404);
    bodies.push(await missingResponse.text());
    for (const post of posts) {
      const response = await request.post(`/api/dashboard/channels/${channelId}/posts`, { data: { postId: post.id } });
      expect(response.status(), await response.text()).toBe(404);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await prisma.channelPost.count({ where: { channelId } })).toBe(0);
  } finally {
    await cleanup([channelId], posts.map(({ id }) => id));
  }
});

test("rule materialization never inserts or reactivates non-publishable candidates", async ({ request }, testInfo) => {
  await requireDatabase(request, testInfo);
  const nonce = Date.now().toString(36);
  const channelId = `final-rule-channel-${nonce}`;
  const slug = `final-rule-${nonce}`;
  const category = `Final Rule ${nonce}`;
  const posts = ["purchase", "hidden", "unpublished", "pending", "removed"].map((visibility) => postData({
    id: `final-rule-${visibility}-${nonce}`,
    visibility,
    title: `rule-${visibility}-secret-${nonce}`,
    category
  }));

  try {
    await prisma.channel.create({ data: channelData({ id: channelId, slug, visibility: "private" }) });
    await prisma.post.createMany({ data: posts });
    await prisma.channelRule.create({
      data: { id: `final-rule-${nonce}`, channelId, kind: "category", value: category, enabled: true, createdByUserId: "c2" }
    });
    await prisma.channelPost.createMany({
      data: [
        { id: `final-rule-hidden-row-${nonce}`, channelId, postId: posts[1].id, source: "rule", status: "removed", addedByUserId: "c2", reviewedByUserId: "c2" },
        { id: `final-rule-unpublished-row-${nonce}`, channelId, postId: posts[2].id, source: "rule", status: "active", addedByUserId: "c2", reviewedByUserId: "c2" }
      ]
    });

    expect(await materializeChannel(channelId)).toEqual({ matched: 1, activated: 1, removed: 1 });
    const rows = await prisma.channelPost.findMany({ where: { channelId }, select: { id: true, postId: true, status: true } });
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ postId: posts[0].id, status: "active" }),
      expect.objectContaining({ postId: posts[1].id, status: "removed" }),
      expect.objectContaining({ postId: posts[2].id, status: "removed" })
    ]));
    expect(rows.find(({ postId }) => postId === posts[3].id)).toBeUndefined();
    expect(rows.find(({ postId }) => postId === posts[4].id)).toBeUndefined();

    const retainedHiddenRow = rows.find(({ postId }) => postId === posts[1].id)!;
    await prisma.post.update({ where: { id: posts[1].id }, data: { visibility: "purchase" } });
    expect(await materializeChannel(channelId)).toEqual({ matched: 2, activated: 1, removed: 0 });
    expect(await prisma.channelPost.findUniqueOrThrow({
      where: { id: retainedHiddenRow.id },
      select: { postId: true, status: true }
    })).toEqual({ postId: posts[1].id, status: "active" });
  } finally {
    await cleanup([channelId], posts.map(({ id }) => id));
  }
});
