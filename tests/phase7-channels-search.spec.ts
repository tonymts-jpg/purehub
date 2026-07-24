import { expect, request as playwrightRequest, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import { ADMIN_SECTIONS, isChannelAdminRole } from "../lib/admin-auth";
import { resolveChannelAccess } from "../lib/channels/auth";
import { readChannelJson } from "../lib/channels/http";
import {
  CHANNEL_QUOTAS,
  assertNoChannelIdentityOverrides,
  channelCursorMatchesScope,
  encodeChannelCursor,
  parseChannelCursor,
  projectChannelSafeSummary,
  resolveChannelIndexJob,
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

test("phase 7 lifecycle job resolver selects deterministic creation jobs", () => {
  const version = "2026-07-24T00:00:00.000Z";
  expect(resolveChannelIndexJob("channel-draft", "draft", version)).toEqual({
    idempotencyKey: "delete-index:channel:channel-draft:2026-07-24T00:00:00.000Z",
    kind: "delete_index",
    channelId: "channel-draft",
    entityType: "channel",
    entityId: "channel-draft"
  });
  expect(resolveChannelIndexJob("channel-official", "active", version)).toEqual({
    idempotencyKey: "index:channel:channel-official:2026-07-24T00:00:00.000Z",
    kind: "index_entity",
    channelId: "channel-official",
    entityType: "channel",
    entityId: "channel-official"
  });
});

test("phase 7 optional JSON body accepts empty but rejects malformed JSON", async () => {
  await expect(readChannelJson(new Request("http://localhost/api/test", {
    method: "POST"
  }), true)).resolves.toEqual({});
  await expect(readChannelJson(new Request("http://localhost/api/test", {
    method: "POST",
    body: ""
  }), true)).resolves.toEqual({});
  await expect(readChannelJson(new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{\"valid\":true}"
  }), true)).resolves.toEqual({ valid: true });
  await expect(readChannelJson(new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  }), true)).rejects.toThrow("valid JSON");
  await expect(readChannelJson(new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: " "
  }), true)).rejects.toThrow("valid JSON");
});

test("phase 7 identity input helpers reject normalized variants and preserve explicit targets", () => {
  for (const field of [
    "userId",
    "actorId",
    "ownerUserId",
    "owner_id",
    "creatorId",
    "creator-user-id",
    "createdByUserId",
    "newOwnerUserId",
    "newOwnerId",
    "reviewedByUserId",
    "invitedByUserId",
    "acceptedByUserId",
    "targetUserId"
  ]) {
    expect(() => assertNoChannelIdentityOverrides({ [field]: "c2" })).toThrow(field);
    expect(() => assertNoChannelIdentityOverrides({}, new URLSearchParams([[field, "c2"]]))).toThrow(field);
  }
  expect(() => assertNoChannelIdentityOverrides(
    { newOwnerUserId: "c2" },
    undefined,
    { allowBody: ["newOwnerUserId"] }
  )).not.toThrow();
  expect(() => assertNoChannelIdentityOverrides({ avatarAssetId: "asset-1" })).not.toThrow();

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
  const createdChannelIds: string[] = [];
  try {
    await requirePhase7(creatorRequest, testInfo);
    await signInCreator(creatorRequest);
    await signInAdmin(adminRequest);

    const nonce = Date.now().toString(36);
    const creatorCreate = await creatorRequest.post("/api/dashboard/channels", {
      headers: authHeaders,
      data: {
        ...validCreatorChannel,
        slug: `lifecycle-creator-${nonce}`,
        visibility: "public",
        discoverability: "discoverable"
      }
    });
    expect(creatorCreate.status(), await creatorCreate.text()).toBe(201);
    const creatorChannel = (await creatorCreate.json()).channel;
    createdChannelIds.push(creatorChannel.id);
    expect(creatorChannel).toMatchObject({ kind: "creator", status: "draft", ownerUserId: "c1" });

    const dashboard = await creatorRequest.get("/api/dashboard/channels");
    expect(dashboard.ok(), await dashboard.text()).toBeTruthy();
    expect((await dashboard.json()).channels.map((channel: { id: string }) => channel.id)).toContain(creatorChannel.id);

    const creatorCreateDetail = await adminRequest.get(`/api/admin/channels/${creatorChannel.id}`);
    expect(creatorCreateDetail.ok(), await creatorCreateDetail.text()).toBeTruthy();
    const creatorCreateDetailBody = await creatorCreateDetail.json();
    expect(creatorCreateDetailBody.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "delete_index",
        idempotencyKey: expect.stringMatching(`^delete-index:channel:${creatorChannel.id}:`),
        status: expect.any(String),
        attempts: expect.any(Number),
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      })
    ]));
    for (const job of creatorCreateDetailBody.jobs) {
      expect(job).not.toHaveProperty("lastError");
    }

    const malformedSubmit = await creatorRequest.post(`/api/dashboard/channels/${creatorChannel.id}/submit`, {
      headers: { ...authHeaders, "content-type": "application/json" },
      data: "{"
    });
    expect(malformedSubmit.status(), await malformedSubmit.text()).toBe(400);
    const stillDraft = await creatorRequest.get(`/api/dashboard/channels/${creatorChannel.id}`);
    expect(stillDraft.ok(), await stillDraft.text()).toBeTruthy();
    expect((await stillDraft.json()).channel.status).toBe("draft");

    const submitted = await creatorRequest.post(`/api/dashboard/channels/${creatorChannel.id}/submit`, {
      headers: authHeaders
    });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    expect((await submitted.json()).channel.status).toBe("pending");

    const pendingPublic = await creatorRequest.get("/api/channels?limit=50");
    expect(pendingPublic.ok(), await pendingPublic.text()).toBeTruthy();
    expect((await pendingPublic.json()).channels.map((channel: { id?: string }) => channel.id))
      .not.toContain(creatorChannel.id);

    const rejected = await adminRequest.post(`/api/admin/channels/${creatorChannel.id}/review`, {
      headers: authHeaders,
      data: { decision: "rejected", note: "Lifecycle acceptance rejection." }
    });
    expect(rejected.ok(), await rejected.text()).toBeTruthy();
    expect((await rejected.json()).channel).toMatchObject({
      status: "rejected",
      reviewNote: "Lifecycle acceptance rejection."
    });
    const rejectedPublic = await creatorRequest.get("/api/channels?limit=50");
    expect(rejectedPublic.ok(), await rejectedPublic.text()).toBeTruthy();
    expect((await rejectedPublic.json()).channels.map((channel: { id?: string }) => channel.id))
      .not.toContain(creatorChannel.id);

    const resubmitted = await creatorRequest.post(`/api/dashboard/channels/${creatorChannel.id}/submit`, {
      headers: authHeaders
    });
    expect(resubmitted.ok(), await resubmitted.text()).toBeTruthy();
    expect((await resubmitted.json()).channel.status).toBe("pending");

    const approved = await adminRequest.post(`/api/admin/channels/${creatorChannel.id}/review`, {
      headers: authHeaders,
      data: { decision: "approved", note: "Lifecycle acceptance approved." }
    });
    expect(approved.ok(), await approved.text()).toBeTruthy();
    expect((await approved.json()).channel).toMatchObject({
      status: "active",
      reviewNote: "Lifecycle acceptance approved."
    });
    const activePublic = await creatorRequest.get("/api/channels?limit=50");
    expect(activePublic.ok(), await activePublic.text()).toBeTruthy();
    expect((await activePublic.json()).channels.map((channel: { id?: string }) => channel.id))
      .toContain(creatorChannel.id);

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
    createdChannelIds.push(official.id);
    expect(official).toMatchObject({ kind: "official", status: "active", ownerUserId: "admin-demo" });

    const readAdminDetail = async () => {
      const response = await adminRequest.get(`/api/admin/channels/${official.id}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    const counts = (detail: {
      auditLogs: Array<{ action: string }>;
      jobs: Array<{ idempotencyKey: string; kind: string }>;
    }) => ({
      audits: detail.auditLogs.length,
      jobs: detail.jobs.length,
      takeoverAudits: detail.auditLogs.filter((audit) => audit.action === "channel.takeover").length,
      suspendAudits: detail.auditLogs.filter((audit) => audit.action === "channel.suspend").length,
      restoreAudits: detail.auditLogs.filter((audit) => audit.action === "channel.restore").length,
      archiveAudits: detail.auditLogs.filter((audit) => audit.action === "channel.archive").length
    });

    const officialCreateDetail = await readAdminDetail();
    expect(officialCreateDetail.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "index_entity",
        idempotencyKey: expect.stringMatching(`^index:channel:${official.id}:`),
        status: expect.any(String),
        attempts: expect.any(Number),
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      })
    ]));
    for (const job of officialCreateDetail.jobs) {
      expect(job).not.toHaveProperty("lastError");
    }
    const officialCreateJobKeys = officialCreateDetail.jobs
      .map((job: { idempotencyKey: string }) => job.idempotencyKey);
    expect(new Set(officialCreateJobKeys).size).toBe(officialCreateJobKeys.length);

    const malformedSuspend = await adminRequest.post(`/api/admin/channels/${official.id}/suspend`, {
      headers: { ...authHeaders, "content-type": "application/json" },
      data: "{"
    });
    expect(malformedSuspend.status(), await malformedSuspend.text()).toBe(400);
    expect((await readAdminDetail()).channel.status).toBe("active");

    const beforeTakeover = counts(await readAdminDetail());
    const takeover = await adminRequest.post(`/api/admin/channels/${official.id}/takeover`, {
      headers: authHeaders,
      data: { newOwnerUserId: "c1" }
    });
    expect(takeover.ok(), await takeover.text()).toBeTruthy();
    expect((await takeover.json()).channel.ownerUserId).toBe("c1");
    const afterTakeover = counts(await readAdminDetail());
    expect(afterTakeover.takeoverAudits).toBe(beforeTakeover.takeoverAudits + 1);

    const takeoverNoOp = await adminRequest.post(`/api/admin/channels/${official.id}/takeover`, {
      headers: authHeaders,
      data: { newOwnerUserId: "c1" }
    });
    expect(takeoverNoOp.ok(), await takeoverNoOp.text()).toBeTruthy();
    expect(counts(await readAdminDetail())).toEqual(afterTakeover);

    const beforeSuspend = counts(await readAdminDetail());
    const suspended = await adminRequest.post(`/api/admin/channels/${official.id}/suspend`, {
      headers: authHeaders
    });
    expect(suspended.ok(), await suspended.text()).toBeTruthy();
    expect((await suspended.json()).channel.status).toBe("suspended");
    const afterSuspend = counts(await readAdminDetail());
    expect(afterSuspend.suspendAudits).toBe(beforeSuspend.suspendAudits + 1);

    const suspendNoOp = await adminRequest.post(`/api/admin/channels/${official.id}/suspend`, {
      headers: authHeaders
    });
    expect(suspendNoOp.ok(), await suspendNoOp.text()).toBeTruthy();
    expect(counts(await readAdminDetail())).toEqual(afterSuspend);
    const suspendedPublic = await creatorRequest.get("/api/channels?limit=50");
    expect(suspendedPublic.ok(), await suspendedPublic.text()).toBeTruthy();
    expect((await suspendedPublic.json()).channels.map((channel: { id?: string }) => channel.id))
      .not.toContain(official.id);

    const malformedRestore = await adminRequest.post(`/api/admin/channels/${official.id}/restore`, {
      headers: { ...authHeaders, "content-type": "application/json" },
      data: "{"
    });
    expect(malformedRestore.status(), await malformedRestore.text()).toBe(400);
    expect((await readAdminDetail()).channel.status).toBe("suspended");

    const beforeRestore = counts(await readAdminDetail());
    const restored = await adminRequest.post(`/api/admin/channels/${official.id}/restore`, {
      headers: authHeaders
    });
    expect(restored.ok(), await restored.text()).toBeTruthy();
    expect((await restored.json()).channel.status).toBe("active");
    const afterRestore = counts(await readAdminDetail());
    expect(afterRestore.restoreAudits).toBe(beforeRestore.restoreAudits + 1);

    const restoreNoOp = await adminRequest.post(`/api/admin/channels/${official.id}/restore`, {
      headers: authHeaders
    });
    expect(restoreNoOp.ok(), await restoreNoOp.text()).toBeTruthy();
    expect(counts(await readAdminDetail())).toEqual(afterRestore);

    const restoredPublic = await creatorRequest.get("/api/channels?limit=50");
    expect(restoredPublic.ok(), await restoredPublic.text()).toBeTruthy();
    expect((await restoredPublic.json()).channels.map((channel: { id?: string }) => channel.id))
      .toContain(official.id);

    const beforeArchive = counts(await readAdminDetail());
    const archived = await adminRequest.patch(`/api/admin/channels/${official.id}`, {
      headers: authHeaders,
      data: { status: "archived" }
    });
    expect(archived.ok(), await archived.text()).toBeTruthy();
    expect((await archived.json()).channel.status).toBe("archived");
    const afterArchive = counts(await readAdminDetail());
    expect(afterArchive.archiveAudits).toBe(beforeArchive.archiveAudits + 1);

    const archiveNoOp = await adminRequest.patch(`/api/admin/channels/${official.id}`, {
      headers: authHeaders,
      data: { status: "archived" }
    });
    expect(archiveNoOp.ok(), await archiveNoOp.text()).toBeTruthy();
    expect(counts(await readAdminDetail())).toEqual(afterArchive);
    const archivedPublic = await creatorRequest.get("/api/channels?limit=50");
    expect(archivedPublic.ok(), await archivedPublic.text()).toBeTruthy();
    expect((await archivedPublic.json()).channels.map((channel: { id?: string }) => channel.id))
      .not.toContain(official.id);

    const archiveCreator = await adminRequest.patch(`/api/admin/channels/${creatorChannel.id}`, {
      headers: authHeaders,
      data: { status: "archived" }
    });
    expect(archiveCreator.ok(), await archiveCreator.text()).toBeTruthy();

    const detailBody = await readAdminDetail();
    expect(detailBody.memberships.filter((membership: { role: string; status: string }) =>
      membership.role === "owner" && membership.status === "active"
    )).toHaveLength(1);
    expect(detailBody.memberships.find((membership: { userId: string }) => membership.userId === "c1"))
      .toMatchObject({ role: "owner", status: "active" });
    expect(detailBody.auditLogs.some((audit: { action: string }) => audit.action === "channel.takeover")).toBeTruthy();
    const finalJobKeys = detailBody.jobs.map((job: { idempotencyKey: string }) => job.idempotencyKey);
    expect(new Set(finalJobKeys).size).toBe(finalJobKeys.length);
  } finally {
    for (const id of createdChannelIds) {
      try {
        await adminRequest.patch(`/api/admin/channels/${id}`, {
          headers: authHeaders,
          data: { status: "archived" }
        });
      } catch {
        // Cleanup is best-effort after assertion failures.
      }
    }
    await creatorRequest.dispose();
    await adminRequest.dispose();
  }
});

test("phase 7 lifecycle rejects self-review, self-restore, and forged mutation identities", async ({}, testInfo) => {
  const creatorRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const adminRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const createdChannelIds: string[] = [];
  try {
    await requirePhase7(creatorRequest, testInfo);
    await signInCreator(creatorRequest);
    await signInAdmin(adminRequest);
    const nonce = Date.now().toString(36);

    for (const [index, field] of [
      "ownerUserId",
      "creatorId",
      "newOwnerUserId",
      "newOwnerId",
      "reviewedByUserId",
      "invitedByUserId",
      "acceptedByUserId"
    ].entries()) {
      const forged = await creatorRequest.post("/api/dashboard/channels", {
        headers: authHeaders,
        data: {
          ...validCreatorChannel,
          slug: `lifecycle-forged-${index}-${nonce}`,
          [field]: "admin-demo"
        }
      });
      expect(forged.status(), `${field}: ${await forged.text()}`).toBe(400);
    }
    const forgedQuery = await creatorRequest.post(
      `/api/dashboard/channels?creator_id=admin-demo`,
      {
        headers: authHeaders,
        data: { ...validCreatorChannel, slug: `lifecycle-forged-query-${nonce}` }
      }
    );
    expect(forgedQuery.status(), await forgedQuery.text()).toBe(400);

    const created = await creatorRequest.post("/api/dashboard/channels", {
      headers: authHeaders,
      data: { ...validCreatorChannel, slug: `lifecycle-self-${nonce}` }
    });
    expect(created.status(), await created.text()).toBe(201);
    const channel = (await created.json()).channel;
    createdChannelIds.push(channel.id);

    const forgedPatch = await creatorRequest.patch(`/api/dashboard/channels/${channel.id}`, {
      headers: authHeaders,
      data: { name: "Forged Identity Update", creatorId: "admin-demo" }
    });
    expect(forgedPatch.status(), await forgedPatch.text()).toBe(400);
    const unchanged = await creatorRequest.get(`/api/dashboard/channels/${channel.id}`);
    expect(unchanged.ok(), await unchanged.text()).toBeTruthy();
    expect((await unchanged.json()).channel.name).toBe(validCreatorChannel.name);

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
    createdChannelIds.push(official.id);
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
    for (const id of createdChannelIds) {
      try {
        await adminRequest.patch(`/api/admin/channels/${id}`, {
          headers: authHeaders,
          data: { status: "archived" }
        });
      } catch {
        // Cleanup is best-effort after assertion failures.
      }
    }
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
