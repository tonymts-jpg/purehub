import { expect, request as playwrightRequest, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import { ADMIN_SECTIONS, isChannelAdminRole } from "../lib/admin-auth";
import { resolveChannelAccess } from "../lib/channels/auth";
import {
  CHANNEL_QUOTAS,
  assertNoChannelIdentityOverrides,
  channelCursorMatchesScope,
  encodeChannelCursor,
  parseChannelCursor,
  projectChannelSafeSummary,
  resolveChannelLifecycleTransition,
  validateChannelPatchInput,
  validateChannelTakeoverInput,
  validateQuotaOverrideInput,
  validateChannelInput
} from "../lib/channels/types";
import {
  ChannelRepositoryError,
  channelFeedAfterPredicate,
  channelListAfterPredicate,
  isChannelSelfReview,
  isSerializableConflict,
  retrySerializableOperation
} from "../lib/channels/repository";
import { authHeaders, hasDatabase, signInAdmin, signInCreator, signInFan, signInSupport } from "./auth-helpers";

async function requirePhase7(request: APIRequestContext, testInfo: TestInfo) {
  test.skip(testInfo.project.name === "mobile", "Phase 7 channel mutations run once against the shared staging database.");
  test.skip(!(await hasDatabase(request)), "Phase 7 requires the seeded PostgreSQL database.");
}

test("phase 7 admin channel list includes representative seeded channels", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  await signInAdmin(request);

  const response = await request.get("/api/admin/channels");
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  const slugs = body.channels.map((channel: { slug: string }) => channel.slug);

  expect(slugs).toEqual(expect.arrayContaining(["purehub-official", "yuki-studio", "private-curators"]));
});

const validCreatorChannel = {
  slug: "phase-seven-test",
  name: "Phase Seven Test",
  description: "Channel ACL acceptance fixture.",
  visibility: "private",
  discoverability: "hidden",
  memberPostPolicy: "approval_required"
};

test("phase 7 ACL validation and cursor helpers enforce the shared contract", () => {
  const cursor = {
    scope: "channel-feed" as const,
    channelId: "channel-private-curators",
    pinnedAt: "2026-07-24T00:00:00.000Z",
    position: 4,
    createdAt: "2026-07-23T00:00:00.000Z",
    id: "channel-post-4"
  };

  expect(parseChannelCursor(encodeChannelCursor(cursor))).toEqual(cursor);
  expect(parseChannelCursor(encodeChannelCursor({ ...cursor, position: -4 }))).toEqual({ ...cursor, position: -4 });
  expect(parseChannelCursor("not-base64-json")).toBeNull();
  expect(parseChannelCursor(Buffer.from(JSON.stringify({ id: "missing-fields" })).toString("base64url"))).toBeNull();
  expect(channelCursorMatchesScope(cursor, "channel-feed", "channel-private-curators")).toBeTruthy();
  expect(channelCursorMatchesScope(cursor, "channel-list")).toBeFalsy();
  expect(channelCursorMatchesScope(cursor, "channel-feed", "another-channel")).toBeFalsy();

  const validated = validateChannelInput({
    ...validCreatorChannel,
    ownerUserId: "c2",
    createdByUserId: "c2"
  });
  expect(validated).toEqual(validCreatorChannel);
  expect(validated).not.toHaveProperty("ownerUserId");
  expect(validated).not.toHaveProperty("createdByUserId");
});

test("phase 7 ACL resolver preserves lifecycle and visibility boundaries", () => {
  expect(resolveChannelAccess({ status: "suspended", visibility: "private", role: null, adminRole: "super_admin" }))
    .toEqual({ canRead: true, canManage: true, canCurate: true, canManageMembers: true, role: null });
  expect(resolveChannelAccess({ status: "active", visibility: "private", role: "owner", adminRole: null }))
    .toEqual({ canRead: true, canManage: true, canCurate: true, canManageMembers: true, role: "owner" });
  expect(resolveChannelAccess({ status: "draft", visibility: "private", role: "owner", adminRole: null }))
    .toEqual({ canRead: true, canManage: true, canCurate: false, canManageMembers: false, role: "owner" });
  expect(resolveChannelAccess({ status: "pending", visibility: "private", role: "owner", adminRole: null }))
    .toEqual({ canRead: true, canManage: false, canCurate: false, canManageMembers: false, role: "owner" });
  expect(resolveChannelAccess({ status: "active", visibility: "private", role: "editor", adminRole: null }))
    .toEqual({ canRead: true, canManage: false, canCurate: true, canManageMembers: false, role: "editor" });
  expect(resolveChannelAccess({ status: "active", visibility: "private", role: "member", adminRole: null }))
    .toEqual({ canRead: true, canManage: false, canCurate: false, canManageMembers: false, role: "member" });
  expect(resolveChannelAccess({ status: "active", visibility: "public", role: null, adminRole: null }))
    .toEqual({ canRead: true, canManage: false, canCurate: false, canManageMembers: false, role: null });
  expect(resolveChannelAccess({ status: "active", visibility: "private", role: null, adminRole: null }))
    .toEqual({ canRead: false, canManage: false, canCurate: false, canManageMembers: false, role: null });
  expect(resolveChannelAccess({ status: "suspended", visibility: "public", role: "owner", adminRole: null }))
    .toEqual({ canRead: false, canManage: false, canCurate: false, canManageMembers: false, role: null });
  for (const adminRole of ["finance_admin", "support_admin", "analyst"] as const) {
    expect(resolveChannelAccess({ status: "active", visibility: "private", role: null, adminRole }))
      .toEqual({ canRead: false, canManage: false, canCurate: false, canManageMembers: false, role: null });
  }
});

test("phase 7 quota constants and admin ACL sections match the approved policy", () => {
  expect(CHANNEL_QUOTAS).toEqual({ "level-1": 1, "level-2": 3, "level-3": 5 });
  expect(ADMIN_SECTIONS.super_admin).toContain("channels");
  expect(ADMIN_SECTIONS.ops_admin).toContain("channels");
  expect(ADMIN_SECTIONS.content_admin).toContain("channels");
  expect(ADMIN_SECTIONS.finance_admin).not.toContain("channels");
  expect(ADMIN_SECTIONS.support_admin).not.toContain("channels");
  expect(ADMIN_SECTIONS.analyst).not.toContain("channels");
  expect(["super_admin", "ops_admin", "content_admin"].map(isChannelAdminRole)).toEqual([true, true, true]);
  expect(["finance_admin", "support_admin", "analyst"].map(isChannelAdminRole)).toEqual([false, false, false]);
});

test("phase 7 private safe summary omits internal and authorization fields", () => {
  const summary = projectChannelSafeSummary({
    id: "channel-private-curators",
    slug: "private-curators",
    name: "Private Curators",
    description: "A discoverable private channel.",
    kind: "creator",
    visibility: "private",
    discoverability: "discoverable",
    status: "active",
    ownerUserId: "c2",
    createdByUserId: "c2",
    memberPostPolicy: "approval_required",
    avatarAssetId: "internal-avatar-id",
    coverAssetId: "internal-cover-id",
    reviewNote: "internal review",
    reviewedAt: new Date("2026-07-24T00:00:00.000Z"),
    suspendedAt: null,
    createdAt: new Date("2026-07-23T00:00:00.000Z"),
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    owner: { id: "c2", name: "Chen Mo", handle: "chenmo", avatar: "M" }
  });

  expect(summary).toEqual({
    slug: "private-curators",
    name: "Private Curators",
    description: "A discoverable private channel.",
    kind: "creator",
    visibility: "private",
    discoverability: "discoverable",
    status: "active"
  });
  for (const forbidden of [
    "id", "ownerUserId", "createdByUserId", "memberPostPolicy", "avatarAssetId", "coverAssetId",
    "reviewNote", "reviewedAt", "suspendedAt", "createdAt", "updatedAt", "owner", "access", "posts", "nextCursor"
  ]) {
    expect(summary).not.toHaveProperty(forbidden);
  }
});

test("phase 7 cursor predicates use complete stable tuples without anchor lookup", () => {
  const listCursor = {
    scope: "channel-list" as const,
    channelId: null,
    pinnedAt: null,
    position: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    id: "channel-b"
  };
  expect(channelListAfterPredicate(listCursor)).toEqual({
    OR: [
      { createdAt: { lt: new Date("2026-07-23T00:00:00.000Z") } },
      { createdAt: new Date("2026-07-23T00:00:00.000Z"), id: { lt: "channel-b" } }
    ]
  });

  const feedCursor = {
    scope: "channel-feed" as const,
    channelId: "channel-private-curators",
    pinnedAt: "2026-07-24T00:00:00.000Z",
    position: 4,
    createdAt: "2026-07-22T00:00:00.000Z",
    id: "channel-post-b"
  };
  const feedPredicate = channelFeedAfterPredicate(feedCursor);
  expect(feedPredicate).toMatchObject({
    OR: expect.arrayContaining([
      { pinnedAt: { lt: new Date(feedCursor.pinnedAt) } },
      { pinnedAt: null }
    ])
  });
  expect(JSON.stringify(feedPredicate)).toContain('"post":{"createdAt"');
  expect(JSON.stringify(feedPredicate)).toContain('"id":{"lt":"channel-post-b"}');
  expect(feedPredicate).not.toHaveProperty("cursor");
});

test("phase 7 review separation and serializable quota retry are deterministic", async () => {
  expect(isChannelSelfReview("c1", "c1")).toBeTruthy();
  expect(isChannelSelfReview("admin-demo", "c1")).toBeFalsy();
  expect(isSerializableConflict({ code: "P2034" })).toBeTruthy();
  expect(isSerializableConflict({ code: "P2002" })).toBeFalsy();

  let attempts = 0;
  await expect(retrySerializableOperation(async () => {
    attempts += 1;
    if (attempts < 3) throw { code: "P2034" };
    return "created";
  }, 3)).resolves.toBe("created");
  expect(attempts).toBe(3);

  await expect(retrySerializableOperation(async () => {
    throw { code: "P2034" };
  }, 2)).rejects.toMatchObject({
    name: ChannelRepositoryError.name,
    status: 409
  });
});

test("phase 7 lifecycle transition rules are strict and idempotent", () => {
  expect(resolveChannelLifecycleTransition("suspend", "active"))
    .toEqual({ status: "suspended", changed: true, jobKind: "delete_index" });
  expect(resolveChannelLifecycleTransition("suspend", "suspended"))
    .toEqual({ status: "suspended", changed: false, jobKind: null });
  expect(resolveChannelLifecycleTransition("restore", "suspended"))
    .toEqual({ status: "active", changed: true, jobKind: "index_entity" });
  expect(resolveChannelLifecycleTransition("restore", "active"))
    .toEqual({ status: "active", changed: false, jobKind: null });
  expect(resolveChannelLifecycleTransition("archive", "pending"))
    .toEqual({ status: "archived", changed: true, jobKind: "delete_index" });
  expect(resolveChannelLifecycleTransition("archive", "archived"))
    .toEqual({ status: "archived", changed: false, jobKind: null });
  expect(() => resolveChannelLifecycleTransition("suspend", "draft")).toThrow("Only active channels");
  expect(() => resolveChannelLifecycleTransition("restore", "rejected")).toThrow("Only suspended channels");
});

test("phase 7 lifecycle input helpers reject forged identities and invalid targets", () => {
  expect(() => assertNoChannelIdentityOverrides({ ownerUserId: "c2" })).toThrow("ownerUserId");
  expect(() => assertNoChannelIdentityOverrides({ createdByUserId: "c2" })).toThrow("createdByUserId");
  expect(() => assertNoChannelIdentityOverrides({ userId: "c2" })).toThrow("userId");
  expect(() => assertNoChannelIdentityOverrides({ actorId: "c2" })).toThrow("actorId");
  expect(() => assertNoChannelIdentityOverrides({}, new URLSearchParams("actorUserId=c2"))).toThrow("actorUserId");

  expect(validateChannelPatchInput({
    name: "Updated Channel",
    visibility: "private",
    discoverability: "hidden"
  })).toEqual({
    name: "Updated Channel",
    visibility: "private",
    discoverability: "hidden"
  });
  expect(validateChannelPatchInput({ status: "archived" }, true)).toEqual({ status: "archived" });
  expect(() => validateChannelPatchInput({ status: "active" }, true)).toThrow("archived");
  expect(() => validateChannelPatchInput({ ownerUserId: "c2" })).toThrow("ownerUserId");

  expect(validateChannelTakeoverInput({ newOwnerUserId: "c2" })).toEqual({ newOwnerUserId: "c2" });
  expect(() => validateChannelTakeoverInput({ userId: "c2" })).toThrow("userId");

  expect(validateQuotaOverrideInput({ maxChannels: 7, reason: "Approved capacity increase" }))
    .toEqual({ maxChannels: 7, reason: "Approved capacity increase" });
  expect(() => validateQuotaOverrideInput({ userId: "c1", maxChannels: 7, reason: "forged" })).toThrow("userId");
  expect(() => validateQuotaOverrideInput({ maxChannels: -1, reason: "invalid" })).toThrow("maxChannels");
  expect(() => validateQuotaOverrideInput({ maxChannels: 7, reason: " " })).toThrow("reason");
});

test("phase 7 lifecycle routes create, review, transfer, suspend, restore, and archive atomically", async ({}, testInfo) => {
  const creatorRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const adminRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(creatorRequest, testInfo);
    await signInCreator(creatorRequest);
    await signInAdmin(adminRequest);

    const nonce = Date.now().toString(36);
    const creatorCreate = await creatorRequest.post("/api/dashboard/channels", {
      headers: authHeaders,
      data: { ...validCreatorChannel, slug: `lifecycle-creator-${nonce}` }
    });
    expect(creatorCreate.status(), await creatorCreate.text()).toBe(201);
    const creatorChannel = (await creatorCreate.json()).channel;
    expect(creatorChannel).toMatchObject({ kind: "creator", status: "draft", ownerUserId: "c1" });

    const dashboard = await creatorRequest.get("/api/dashboard/channels");
    expect(dashboard.ok(), await dashboard.text()).toBeTruthy();
    expect((await dashboard.json()).channels.map((channel: { id: string }) => channel.id)).toContain(creatorChannel.id);

    const submitted = await creatorRequest.post(`/api/dashboard/channels/${creatorChannel.id}/submit`, {
      headers: authHeaders
    });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    expect((await submitted.json()).channel.status).toBe("pending");

    const reviewed = await adminRequest.post(`/api/admin/channels/${creatorChannel.id}/review`, {
      headers: authHeaders,
      data: { decision: "approved", note: "Lifecycle acceptance approved." }
    });
    expect(reviewed.ok(), await reviewed.text()).toBeTruthy();
    expect((await reviewed.json()).channel).toMatchObject({
      status: "active",
      reviewNote: "Lifecycle acceptance approved."
    });

    const officialCreate = await adminRequest.post("/api/admin/channels", {
      headers: authHeaders,
      data: {
        ...validCreatorChannel,
        slug: `lifecycle-official-${nonce}`,
        visibility: "public",
        discoverability: "discoverable"
      }
    });
    expect(officialCreate.status(), await officialCreate.text()).toBe(201);
    const official = (await officialCreate.json()).channel;
    expect(official).toMatchObject({ kind: "official", status: "active", ownerUserId: "admin-demo" });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const takeover = await adminRequest.post(`/api/admin/channels/${official.id}/takeover`, {
        headers: authHeaders,
        data: { newOwnerUserId: "c1" }
      });
      expect(takeover.ok(), await takeover.text()).toBeTruthy();
      expect((await takeover.json()).channel.ownerUserId).toBe("c1");
    }

    for (const action of ["suspend", "restore"] as const) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await adminRequest.post(`/api/admin/channels/${official.id}/${action}`, {
          headers: authHeaders
        });
        expect(response.ok(), await response.text()).toBeTruthy();
      }
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const archived = await adminRequest.patch(`/api/admin/channels/${official.id}`, {
        headers: authHeaders,
        data: { status: "archived" }
      });
      expect(archived.ok(), await archived.text()).toBeTruthy();
      expect((await archived.json()).channel.status).toBe("archived");
    }

    const detail = await adminRequest.get(`/api/admin/channels/${official.id}`);
    expect(detail.ok(), await detail.text()).toBeTruthy();
    const detailBody = await detail.json();
    expect(detailBody.memberships.filter((membership: { role: string; status: string }) =>
      membership.role === "owner" && membership.status === "active"
    )).toHaveLength(1);
    expect(detailBody.memberships.find((membership: { userId: string }) => membership.userId === "c1"))
      .toMatchObject({ role: "owner", status: "active" });
    expect(detailBody.auditLogs.some((audit: { action: string }) => audit.action === "channel.takeover")).toBeTruthy();
  } finally {
    await creatorRequest.dispose();
    await adminRequest.dispose();
  }
});

test("phase 7 lifecycle rejects self-review, self-restore, and forged mutation identities", async ({}, testInfo) => {
  const creatorRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const adminRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(creatorRequest, testInfo);
    await signInCreator(creatorRequest);
    await signInAdmin(adminRequest);
    const nonce = Date.now().toString(36);

    const forged = await creatorRequest.post("/api/dashboard/channels", {
      headers: authHeaders,
      data: { ...validCreatorChannel, slug: `lifecycle-forged-${nonce}`, ownerUserId: "admin-demo" }
    });
    expect(forged.status(), await forged.text()).toBe(400);

    const created = await creatorRequest.post("/api/dashboard/channels", {
      headers: authHeaders,
      data: { ...validCreatorChannel, slug: `lifecycle-self-${nonce}` }
    });
    expect(created.status(), await created.text()).toBe(201);
    const channel = (await created.json()).channel;
    const submitted = await creatorRequest.post(`/api/dashboard/channels/${channel.id}/submit`, {
      headers: authHeaders
    });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();

    const takeover = await adminRequest.post(`/api/admin/channels/${channel.id}/takeover`, {
      headers: authHeaders,
      data: { newOwnerUserId: "admin-demo" }
    });
    expect(takeover.ok(), await takeover.text()).toBeTruthy();

    const selfReview = await adminRequest.post(`/api/admin/channels/${channel.id}/review`, {
      headers: authHeaders,
      data: { decision: "approved", note: "Must be rejected as self-review." }
    });
    expect(selfReview.status(), await selfReview.text()).toBe(403);

    const officialCreate = await adminRequest.post("/api/admin/channels", {
      headers: authHeaders,
      data: {
        ...validCreatorChannel,
        slug: `lifecycle-self-restore-${nonce}`,
        visibility: "public",
        discoverability: "discoverable"
      }
    });
    expect(officialCreate.status(), await officialCreate.text()).toBe(201);
    const official = (await officialCreate.json()).channel;
    const suspended = await adminRequest.post(`/api/admin/channels/${official.id}/suspend`, {
      headers: authHeaders
    });
    expect(suspended.ok(), await suspended.text()).toBeTruthy();
    const selfRestore = await adminRequest.post(`/api/admin/channels/${official.id}/restore`, {
      headers: authHeaders
    });
    expect(selfRestore.status(), await selfRestore.text()).toBe(403);
    const officialTakeover = await adminRequest.post(`/api/admin/channels/${official.id}/takeover`, {
      headers: authHeaders,
      data: { newOwnerUserId: "c1" }
    });
    expect(officialTakeover.ok(), await officialTakeover.text()).toBeTruthy();
    const restored = await adminRequest.post(`/api/admin/channels/${official.id}/restore`, {
      headers: authHeaders
    });
    expect(restored.ok(), await restored.text()).toBeTruthy();

    const archive = await adminRequest.patch(`/api/admin/channels/${channel.id}`, {
      headers: authHeaders,
      data: { status: "archived" }
    });
    expect(archive.ok(), await archive.text()).toBeTruthy();
    const archiveOfficial = await adminRequest.patch(`/api/admin/channels/${official.id}`, {
      headers: authHeaders,
      data: { status: "archived" }
    });
    expect(archiveOfficial.ok(), await archiveOfficial.text()).toBeTruthy();
  } finally {
    await creatorRequest.dispose();
    await adminRequest.dispose();
  }
});

test("phase 7 private discoverable route exposes safe summary only", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  const response = await request.get("/api/channels/private-curators");
  expect(response.ok(), await response.text()).toBeTruthy();
  const channel = (await response.json()).channel;
  expect(channel).toMatchObject({
    slug: "private-curators",
    visibility: "private",
    discoverability: "discoverable",
    status: "active"
  });
  for (const forbidden of [
    "id", "ownerUserId", "createdByUserId", "memberPostPolicy", "avatarAssetId", "coverAssetId",
    "reviewNote", "reviewedAt", "suspendedAt", "createdAt", "updatedAt", "owner", "access", "posts", "nextCursor"
  ]) {
    expect(channel).not.toHaveProperty(forbidden);
  }
});

test("phase 7 ACL support admin does not bypass private safe projection", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  await signInSupport(request);
  const response = await request.get("/api/channels/private-curators");
  expect(response.ok(), await response.text()).toBeTruthy();
  const channel = (await response.json()).channel;
  expect(channel).toMatchObject({ slug: "private-curators", visibility: "private", status: "active" });
  expect(channel).not.toHaveProperty("id");
  expect(channel).not.toHaveProperty("access");
  expect(channel).not.toHaveProperty("posts");
});

test("phase 7 cursor route rejects cross-scope pagination state", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  const feedCursor = encodeChannelCursor({
    scope: "channel-feed",
    channelId: "channel-private-curators",
    pinnedAt: null,
    position: null,
    createdAt: "2026-07-24T00:00:00.000Z",
    id: "channel-post-curators-manual"
  });
  const response = await request.get(`/api/channels?cursor=${encodeURIComponent(feedCursor)}`);
  expect(response.status(), await response.text()).toBe(400);
});

test("phase 7 ACL rejects anonymous and fan channel creation", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);

  const anonymous = await request.post("/api/dashboard/channels", { data: validCreatorChannel });
  expect(anonymous.status(), await anonymous.text()).toBe(401);

  await signInFan(request);
  const fan = await request.post("/api/dashboard/channels", { data: validCreatorChannel });
  expect(fan.status(), await fan.text()).toBe(403);
});

test("phase 7 ACL ignores forged ownership fields and legacy role headers", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  await signInFan(request);

  const response = await request.post("/api/dashboard/channels", {
    headers: { "x-admin-role": "super_admin" },
    data: {
      ...validCreatorChannel,
      ownerUserId: "c1",
      createdByUserId: "c1"
    }
  });

  expect(response.status(), await response.text()).toBe(403);
});

test("phase 7 quota returns c1 level two limit and applies an override", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  await signInCreator(request);

  const baseline = await request.get("/api/dashboard/channels");
  expect(baseline.ok(), await baseline.text()).toBeTruthy();
  expect((await baseline.json()).quota).toMatchObject({ levelId: "level-2", limit: 3 });

  const adminRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await signInAdmin(adminRequest);
    const override = await adminRequest.put("/api/admin/channels/quotas/c1", {
      data: { maxChannels: 7, reason: "Phase 7 quota acceptance" }
    });
    expect(override.ok(), await override.text()).toBeTruthy();

    const overridden = await request.get("/api/dashboard/channels");
    expect(overridden.ok(), await overridden.text()).toBeTruthy();
    expect((await overridden.json()).quota).toMatchObject({
      levelId: "level-2",
      limit: 7,
      overridden: true
    });
  } finally {
    try {
      const restore = await adminRequest.put("/api/admin/channels/quotas/c1", {
        data: { maxChannels: 3, reason: "Restore seeded level two quota" }
      });
      expect(restore.ok(), await restore.text()).toBeTruthy();
    } finally {
      await adminRequest.dispose();
    }
  }
});

test("phase 7 ACL resolves admin, owner, editor, member, and non-member permissions", async ({}, testInfo) => {
  const probe = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(probe, testInfo);
  } finally {
    await probe.dispose();
  }

  const cases = [
    {
      signIn: signInAdmin,
      expected: { canRead: true, canManage: true, canCurate: true, canManageMembers: true, role: null }
    },
    {
      signIn: (request: APIRequestContext) => signInCreator(request, "chenmo"),
      expected: { canRead: true, canManage: true, canCurate: true, canManageMembers: true, role: "owner" }
    },
    {
      signIn: signInCreator,
      expected: { canRead: true, canManage: false, canCurate: true, canManageMembers: false, role: "editor" }
    },
    {
      signIn: signInFan,
      expected: { canRead: true, canManage: false, canCurate: false, canManageMembers: false, role: "member" }
    }
  ];

  for (const entry of cases) {
    const context = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      await entry.signIn(context);
      const response = await context.get("/api/channels/private-curators");
      expect(response.ok(), await response.text()).toBeTruthy();
      expect((await response.json()).channel.access).toEqual(entry.expected);
    } finally {
      await context.dispose();
    }
  }
});
