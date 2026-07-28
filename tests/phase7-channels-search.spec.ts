import { expect, request as playwrightRequest, test, type APIRequestContext, type TestInfo } from "@playwright/test";
import { ADMIN_SECTIONS, isChannelAdminRole } from "../lib/admin-auth";
import {
  adminChannelOperations,
  executeChannelOperation,
  officialChannelOperationsAvailable
} from "../components/channels/channel-management-operations";
import { resolveChannelAccess } from "../lib/channels/auth";
import { readChannelJson, requireEmptyChannelQuery } from "../lib/channels/http";
import {
  channelMembershipRateLimit,
  createChannelInvitationToken,
  encodeChannelMemberCursor,
  hashChannelInvitationToken,
  normalizeChannelInvitationEmail,
  normalizeChannelMemberListInput,
  parseChannelMemberCursor,
  resolveInvitationAcceptance,
  resolveInvitationMutationTransition,
  resolveMembershipMutationVisibility,
  resolveMembershipReviewTransition,
  resolveMembershipUpdateTransition,
  validateChannelInvitationInput,
  validateMembershipReviewInput,
  validateMembershipUpdateInput
} from "../lib/channels/membership";
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
  channelMemberAfterPredicate,
  channelFeedAfterPredicate,
  channelListAfterPredicate,
  channelPublicListingWhere,
  isChannelSelfReview,
  isSerializableConflict,
  retryMembershipSerializableOperation,
  retrySerializableOperation,
  validateChannelExclusionMutationInput,
  validateChannelPostMutationInput,
  validateChannelPostPatchInput,
  validateChannelRuleMutationInput
} from "../lib/channels/repository";
import {
  deleteIndexJobKey,
  indexEntityJobKey,
  materializeChannelJobKey,
  phase7JobLeaseWhere,
  phase7JobBackoffSeconds,
  phase7NextLeaseAvailableAt,
  reindexAllJobKey,
  settlePhase7JobLease
} from "../lib/channels/jobs";
import { prisma } from "../lib/prisma";
import { reviewApplicationFromAdmin } from "../lib/admin-repository";
import { createPost } from "../lib/db-repository";
import { setFollow, setLike } from "../lib/social-repository";
import {
  enqueueSearchEntitySync,
  indexSearchEntityJobKey,
  searchEntityEligibilityJobKind
} from "../lib/search/jobs";
import {
  advanceSearchReindexStage,
  encodeSearchCursor,
  normalizeSearchInput,
  parseSearchCursor,
  synchronizeSearchEntity
} from "../lib/search/repository";
import {
  authHeaders,
  hasDatabase,
  registerFan,
  signInAdmin,
  signInCreator,
  signInFan,
  signInSupport
} from "./auth-helpers";

async function requirePhase7(request: APIRequestContext, testInfo: TestInfo) {
  test.skip(testInfo.project.name === "mobile", "Phase 7 channel mutations run once against the shared staging database.");
  test.skip(!(await hasDatabase(request)), "Phase 7 requires the seeded PostgreSQL database.");
}

function captureThrown(operation: () => unknown): unknown {
  try {
    operation();
    throw new Error("Expected operation to fail.");
  } catch (error) {
    return error;
  }
}

async function cleanupPhase7MembershipArtifacts(
  emails: string[],
  assetIds: string[] = [],
  channelIds: string[] = []
) {
  const normalizedEmails = emails.map((email) => email.trim().toLowerCase());
  const [memberships, invitations] = await Promise.all([
    prisma.channelMembership.findMany({
      where: {
        OR: [
          ...(normalizedEmails.length ? [{ user: { email: { in: normalizedEmails } } }] : []),
          ...(channelIds.length ? [{ channelId: { in: channelIds } }] : [])
        ]
      },
      select: { id: true }
    }),
    prisma.channelInvitation.findMany({
      where: {
        OR: [
          ...(normalizedEmails.length ? [{ email: { in: normalizedEmails } }] : []),
          ...(channelIds.length ? [{ channelId: { in: channelIds } }] : [])
        ]
      },
      select: { id: true }
    })
  ]);
  const membershipIds = memberships.map(({ id }) => id);
  const invitationIds = invitations.map(({ id }) => id);
  await prisma.$transaction([
    prisma.auditLog.deleteMany({
      where: {
        OR: [
          ...(membershipIds.length
            ? [{ targetType: "channel_membership", targetId: { in: membershipIds } }]
            : []),
          ...(invitationIds.length
            ? [{ targetType: "channel_invitation", targetId: { in: invitationIds } }]
            : []),
          ...(channelIds.length
            ? [{ targetType: "channel", targetId: { in: channelIds } }]
            : [])
        ]
      }
    }),
    prisma.searchDocument.deleteMany({
      where: { entityType: "channel", entityId: { in: channelIds } }
    }),
    prisma.channelInvitation.deleteMany({ where: { id: { in: invitationIds } } }),
    prisma.channelMembership.deleteMany({ where: { id: { in: membershipIds } } }),
    prisma.channel.deleteMany({ where: { id: { in: channelIds } } }),
    prisma.mediaAsset.deleteMany({ where: { id: { in: assetIds } } })
  ]);
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

test("phase 7 private membership validation and transitions are strict and idempotent", () => {
  expect(() => assertNoChannelIdentityOverrides(
    {},
    new URLSearchParams("email=forged%40example.com")
  )).toThrow(/authenticated context/i);
  expect(validateMembershipReviewInput({ membershipId: "membership-1", decision: "approved" }))
    .toEqual({ membershipId: "membership-1", decision: "approved" });
  expect(validateMembershipReviewInput({ membershipId: "membership-1", decision: "rejected" }))
    .toEqual({ membershipId: "membership-1", decision: "rejected" });
  expect(() => validateMembershipReviewInput({
    membershipId: "membership-1",
    decision: "approved",
    reviewedByUserId: "forged"
  })).toThrow(/authenticated context/i);

  expect(resolveMembershipReviewTransition("pending", "approved"))
    .toEqual({ status: "active", changed: true });
  expect(resolveMembershipReviewTransition("active", "approved"))
    .toEqual({ status: "active", changed: false });
  expect(resolveMembershipReviewTransition("pending", "rejected"))
    .toEqual({ status: "rejected", changed: true });
  expect(resolveMembershipReviewTransition("rejected", "rejected"))
    .toEqual({ status: "rejected", changed: false });
  expect(() => resolveMembershipReviewTransition("removed", "approved")).toThrow(/pending/i);

  expect(validateMembershipUpdateInput({ role: "editor" })).toEqual({ role: "editor" });
  expect(validateMembershipUpdateInput({ status: "removed" })).toEqual({ status: "removed" });
  expect(() => validateMembershipUpdateInput({ role: "owner" })).toThrow(/owner/i);
  expect(() => validateMembershipUpdateInput({ status: "pending" })).toThrow(/status/i);
  expect(resolveMembershipUpdateTransition(
    { role: "member", status: "active" },
    { role: "editor" }
  )).toEqual({ role: "editor", status: "active", changed: true });
  expect(resolveMembershipUpdateTransition(
    { role: "editor", status: "active" },
    { role: "editor" }
  )).toEqual({ role: "editor", status: "active", changed: false });
  expect(() => resolveMembershipUpdateTransition(
    { role: "owner", status: "active" },
    { status: "removed" }
  )).toThrow(/owner/i);

  expect(resolveMembershipMutationVisibility("join", {
    exists: true,
    status: "active",
    visibility: "private",
    discoverability: "discoverable",
    hasActiveMembership: false,
    hasRemovedMembership: false
  })).toEqual({ allowed: true });
  expect(resolveMembershipMutationVisibility("join", {
    exists: true,
    status: "active",
    visibility: "public",
    discoverability: "discoverable",
    hasActiveMembership: false,
    hasRemovedMembership: false
  })).toEqual({ allowed: true });
  for (const channel of [
    {
      exists: false,
      status: null,
      visibility: null,
      discoverability: null,
      hasActiveMembership: false,
      hasRemovedMembership: false
    },
    {
      exists: true,
      status: "suspended",
      visibility: "private",
      discoverability: "discoverable",
      hasActiveMembership: false,
      hasRemovedMembership: false
    },
    {
      exists: true,
      status: "active",
      visibility: "private",
      discoverability: "hidden",
      hasActiveMembership: false,
      hasRemovedMembership: false
    }
  ] as const) {
    expect(captureThrown(() => resolveMembershipMutationVisibility("join", channel)))
      .toMatchObject({ status: 404 });
  }
  expect(captureThrown(() => resolveMembershipMutationVisibility("leave", {
    exists: true,
    status: "active",
    visibility: "private",
    discoverability: "hidden",
    hasActiveMembership: false,
    hasRemovedMembership: false
  }))).toMatchObject({ status: 404 });
  expect(resolveMembershipMutationVisibility("leave", {
    exists: true,
    status: "active",
    visibility: "private",
    discoverability: "hidden",
    hasActiveMembership: false,
    hasRemovedMembership: true
  })).toEqual({ allowed: true });
});

test("phase 7 invitation tokens, email binding, and rate scopes use the approved contract", () => {
  const captureError = (operation: () => unknown) => {
    try {
      operation();
      throw new Error("Expected operation to fail.");
    } catch (error) {
      return error;
    }
  };
  expect(normalizeChannelInvitationEmail("  Fan@Example.COM ")).toBe("fan@example.com");
  expect(() => normalizeChannelInvitationEmail("not-an-email")).toThrow(/email/i);
  expect(validateChannelInvitationInput({ email: " Fan@Example.COM " }))
    .toEqual({ email: "fan@example.com" });
  expect(() => validateChannelInvitationInput({ email: "fan@example.com", userId: "forged" }))
    .toThrow(/authenticated context/i);

  const invitation = createChannelInvitationToken();
  expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(invitation.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(hashChannelInvitationToken(invitation.token)).toBe(invitation.tokenHash);
  expect(hashChannelInvitationToken(`${invitation.token}x`)).not.toBe(invitation.tokenHash);
  const now = new Date("2026-07-24T00:00:00.000Z");
  expect(resolveInvitationAcceptance({
    status: "pending",
    email: "fan@example.com",
    expiresAt: new Date("2026-07-31T00:00:00.000Z")
  }, " FAN@example.com ", now)).toEqual({ status: "accepted", changed: true });
  expect(captureError(() => resolveInvitationAcceptance({
    status: "pending",
    email: "fan@example.com",
    expiresAt: new Date("2026-07-31T00:00:00.000Z")
  }, "wrong@example.com", now))).toMatchObject({ status: 403 });
  expect(captureError(() => resolveInvitationAcceptance({
    status: "pending",
    email: "fan@example.com",
    expiresAt: new Date("2026-07-23T23:59:59.999Z")
  }, "fan@example.com", now))).toMatchObject({ status: 409 });
  for (const status of ["revoked", "accepted", "rejected", "expired"] as const) {
    expect(captureError(() => resolveInvitationAcceptance({
      status,
      email: "fan@example.com",
      expiresAt: new Date("2026-07-31T00:00:00.000Z")
    }, "fan@example.com", now))).toMatchObject({ status: 409 });
  }
  expect(resolveInvitationMutationTransition(
    {
      status: "pending",
      expiresAt: new Date("2026-07-23T23:59:59.999Z")
    },
    "accept",
    now
  )).toEqual({ status: "expired", changed: true, conflict: "Invitation is expired." });
  expect(resolveInvitationMutationTransition(
    {
      status: "pending",
      expiresAt: new Date("2026-07-31T00:00:00.000Z")
    },
    "reject",
    now
  )).toEqual({ status: "rejected", changed: true, conflict: null });
  expect(resolveInvitationMutationTransition(
    {
      status: "rejected",
      expiresAt: new Date("2026-07-31T00:00:00.000Z")
    },
    "reject",
    now
  )).toEqual({ status: "rejected", changed: false, conflict: null });

  expect(channelMembershipRateLimit("join", "fan-1")).toEqual({
    scope: "channel-join",
    subject: "fan-1",
    limit: 10,
    windowSeconds: 3600
  });
  expect(channelMembershipRateLimit("invite", "owner-1")).toEqual({
    scope: "channel-invite",
    subject: "owner-1",
    limit: 50,
    windowSeconds: 3600
  });
  expect(channelMembershipRateLimit("invite-accept", "fan-1")).toEqual({
    scope: "channel-invite-accept",
    subject: "fan-1",
    limit: 20,
    windowSeconds: 3600
  });
});

test("phase 7 membership cursor uses a full bounded channel tuple", () => {
  const cursor = {
    scope: "channel-members" as const,
    channelId: "channel-private-curators",
    createdAt: "2026-07-24T00:00:00.000Z",
    id: "membership-b"
  };
  expect(parseChannelMemberCursor(encodeChannelMemberCursor(cursor))).toEqual(cursor);
  expect(parseChannelMemberCursor("not-a-cursor")).toBeNull();
  expect(channelMemberAfterPredicate(cursor)).toEqual({
    OR: [
      { createdAt: { gt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }
    ]
  });
  expect(() => parseChannelMemberCursor(encodeChannelMemberCursor({
    ...cursor,
    channelId: "another-channel"
  }), "channel-private-curators")).toThrow(/resource/i);
  expect(normalizeChannelMemberListInput({}, "channel-private-curators"))
    .toEqual({ cursor: null, limit: 20 });
  expect(normalizeChannelMemberListInput({ limit: 50 }, "channel-private-curators"))
    .toEqual({ cursor: null, limit: 50 });
  expect(() => normalizeChannelMemberListInput({ limit: 0 }, "channel-private-curators"))
    .toThrow(/between 1 and 50/i);
  expect(() => normalizeChannelMemberListInput({ limit: 51 }, "channel-private-curators"))
    .toThrow(/between 1 and 50/i);
});

test("phase 7 private directory predicate always excludes hidden channels", () => {
  expect(channelPublicListingWhere(null)).toEqual({
    status: "active",
    OR: [
      { visibility: "public" },
      { visibility: "private", discoverability: "discoverable" }
    ]
  });
  expect(channelPublicListingWhere("fan-1")).toEqual({
    status: "active",
    OR: [
      { visibility: "public" },
      { visibility: "private", discoverability: "discoverable" }
    ]
  });
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

  let membershipAttempts = 0;
  await expect(retryMembershipSerializableOperation(async () => {
    membershipAttempts += 1;
    if (membershipAttempts < 3) throw { code: "P2034" };
    return "committed";
  }, 3)).resolves.toBe("committed");
  expect(membershipAttempts).toBe(3);
  await expect(retryMembershipSerializableOperation(async () => {
    throw { code: "P2034" };
  }, 2)).rejects.toMatchObject({ status: 409 });
  const nonSerializable = new Error("preserve-me");
  await expect(retryMembershipSerializableOperation(async () => {
    throw nonSerializable;
  })).rejects.toBe(nonSerializable);
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
    "targetUserId",
    "user",
    "owner",
    "actor",
    "creator",
    "admin",
    "createdBy",
    "reviewedBy",
    "invitedBy",
    "acceptedBy",
    "newOwner",
    "targetUser"
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
  expect(() => assertNoChannelIdentityOverrides(
    { email: "fan@example.com" },
    undefined,
    { allowBody: ["email"] }
  )).not.toThrow();
  expect(() => requireEmptyChannelQuery(new URLSearchParams())).not.toThrow();
  expect(() => requireEmptyChannelQuery(new URLSearchParams("anything=forged"))).toThrow(/query/i);

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

test("phase 7 private membership join, review, leave, and role boundaries are idempotent", async ({}, testInfo) => {
  const probe = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(probe, testInfo);
  } finally {
    await probe.dispose();
  }

  const ownerRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const editorRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const memberRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const rejectedRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const adminRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const cleanupEmails: string[] = [];
  let temporaryChannelId: string | null = null;
  try {
    await signInCreator(ownerRequest, "chenmo");
    await signInCreator(editorRequest);
    await signInAdmin(adminRequest);
    const member = await registerFan(memberRequest, "phase7-join");
    const rejectedMember = await registerFan(rejectedRequest, "phase7-reject");
    cleanupEmails.push(member.email, rejectedMember.email);

    const publicJoin = await rejectedRequest.post("/api/channels/yuki-studio/join-requests");
    expect(publicJoin.status(), await publicJoin.text()).toBe(409);
    expect(await publicJoin.json()).toMatchObject({
      error: expect.stringMatching(/public channels do not require membership requests/i)
    });

    const before = await memberRequest.get("/api/channels/private-curators");
    expect(before.ok(), await before.text()).toBeTruthy();
    expect((await before.json()).channel).not.toHaveProperty("posts");

    const forged = await memberRequest.post("/api/channels/private-curators/join-requests?userId=c1");
    expect(forged.status(), await forged.text()).toBe(400);
    const arbitraryQuery = await memberRequest.post("/api/channels/private-curators/join-requests?anything=forged");
    expect(arbitraryQuery.status(), await arbitraryQuery.text()).toBe(400);
    const first = await memberRequest.post("/api/channels/private-curators/join-requests");
    expect(first.ok(), await first.text()).toBeTruthy();
    const pending = (await first.json()).membership;
    for (let attempt = 2; attempt <= 10; attempt += 1) {
      const repeated = await memberRequest.post("/api/channels/private-curators/join-requests");
      expect(repeated.ok(), await repeated.text()).toBeTruthy();
      expect((await repeated.json()).membership).toMatchObject({ id: pending.id, status: "pending" });
    }
    const rateLimited = await memberRequest.post("/api/channels/private-curators/join-requests");
    expect(rateLimited.status(), await rateLimited.text()).toBe(429);

    const nonmemberList = await rejectedRequest.get("/api/dashboard/channels/channel-private-curators/members");
    expect(nonmemberList.status(), await nonmemberList.text()).toBe(403);
    const editorList = await editorRequest.get(
      "/api/dashboard/channels/channel-private-curators/members?limit=2"
    );
    expect(editorList.ok(), await editorList.text()).toBeTruthy();
    const firstMemberPage = await editorList.json();
    expect(firstMemberPage.memberships).toHaveLength(2);
    expect(firstMemberPage.nextCursor).toEqual(expect.any(String));
    const secondMemberPage = await editorRequest.get(
      `/api/dashboard/channels/channel-private-curators/members?limit=2&cursor=${encodeURIComponent(firstMemberPage.nextCursor)}`
    );
    expect(secondMemberPage.ok(), await secondMemberPage.text()).toBeTruthy();
    const secondMemberBody = await secondMemberPage.json();
    expect(secondMemberBody.memberships.map((item: { id: string }) => item.id))
      .not.toEqual(expect.arrayContaining(firstMemberPage.memberships.map((item: { id: string }) => item.id)));
    const malformedMemberCursor = await ownerRequest.get(
      "/api/dashboard/channels/channel-private-curators/members?cursor=malformed"
    );
    expect(malformedMemberCursor.status(), await malformedMemberCursor.text()).toBe(400);
    const crossMemberCursor = encodeChannelMemberCursor({
      scope: "channel-members",
      channelId: "another-channel",
      createdAt: "2026-07-24T00:00:00.000Z",
      id: "membership-x"
    });
    const crossMemberPage = await ownerRequest.get(
      `/api/dashboard/channels/channel-private-curators/members?cursor=${encodeURIComponent(crossMemberCursor)}`
    );
    expect(crossMemberPage.status(), await crossMemberPage.text()).toBe(400);

    const ownerList = await ownerRequest.get(
      "/api/dashboard/channels/channel-private-curators/members?limit=50"
    );
    const ownerMembership = (await ownerList.json()).memberships.find(
      (membership: { role: string }) => membership.role === "owner"
    );
    const removeOwner = await ownerRequest.patch(
      `/api/dashboard/channels/channel-private-curators/members/${ownerMembership.id}`,
      { data: { status: "removed" } }
    );
    expect(removeOwner.status(), await removeOwner.text()).toBe(409);
    const ownerLeave = await ownerRequest.delete("/api/channels/private-curators/membership");
    expect(ownerLeave.status(), await ownerLeave.text()).toBe(409);

    const editorReview = await editorRequest.post("/api/dashboard/channels/channel-private-curators/members", {
      data: { membershipId: pending.id, decision: "approved" }
    });
    expect(editorReview.status(), await editorReview.text()).toBe(403);

    const approved = await ownerRequest.post("/api/dashboard/channels/channel-private-curators/members", {
      data: { membershipId: pending.id, decision: "approved" }
    });
    expect(approved.ok(), await approved.text()).toBeTruthy();
    expect((await approved.json()).membership).toMatchObject({ id: pending.id, role: "member", status: "active" });
    const approveAgain = await ownerRequest.post("/api/dashboard/channels/channel-private-curators/members", {
      data: { membershipId: pending.id, decision: "approved" }
    });
    expect(approveAgain.ok(), await approveAgain.text()).toBeTruthy();
    expect((await approveAgain.json()).membership).toMatchObject({ id: pending.id, status: "active" });

    const roleDenied = await editorRequest.patch(
      `/api/dashboard/channels/channel-private-curators/members/${pending.id}`,
      { data: { role: "editor" } }
    );
    expect(roleDenied.status(), await roleDenied.text()).toBe(403);
    const roleChanged = await ownerRequest.patch(
      `/api/dashboard/channels/channel-private-curators/members/${pending.id}`,
      { data: { role: "editor" } }
    );
    expect(roleChanged.ok(), await roleChanged.text()).toBeTruthy();
    expect((await roleChanged.json()).membership).toMatchObject({ role: "editor", status: "active" });

    const privateFeed = await memberRequest.get("/api/channels/private-curators");
    expect(privateFeed.ok(), await privateFeed.text()).toBeTruthy();
    expect((await privateFeed.json()).channel).toHaveProperty("posts");
    const left = await memberRequest.delete("/api/channels/private-curators/membership");
    expect(left.ok(), await left.text()).toBeTruthy();
    const leftAgain = await memberRequest.delete("/api/channels/private-curators/membership");
    expect(leftAgain.ok(), await leftAgain.text()).toBeTruthy();
    const after = await memberRequest.get("/api/channels/private-curators");
    expect((await after.json()).channel).not.toHaveProperty("posts");

    const rejectedJoin = await rejectedRequest.post("/api/channels/private-curators/join-requests");
    expect(rejectedJoin.ok(), await rejectedJoin.text()).toBeTruthy();
    const rejectedMembership = (await rejectedJoin.json()).membership;
    const rejected = await ownerRequest.post("/api/dashboard/channels/channel-private-curators/members", {
      data: { membershipId: rejectedMembership.id, decision: "rejected" }
    });
    expect(rejected.ok(), await rejected.text()).toBeTruthy();
    expect((await rejected.json()).membership).toMatchObject({ status: "rejected" });
    const rejectedAgain = await ownerRequest.post("/api/dashboard/channels/channel-private-curators/members", {
      data: { membershipId: rejectedMembership.id, decision: "rejected" }
    });
    expect(rejectedAgain.ok(), await rejectedAgain.text()).toBeTruthy();

    const slug = `phase7-private-${Date.now().toString(36)}`;
    const created = await ownerRequest.post("/api/dashboard/channels", {
      data: {
        slug,
        name: "Phase Seven Privacy",
        description: "Temporary hidden and inactive membership acceptance.",
        visibility: "private",
        discoverability: "hidden",
        memberPostPolicy: "approval_required"
      }
    });
    expect(created.status(), await created.text()).toBe(201);
    temporaryChannelId = (await created.json()).channel.id;
    const submitted = await ownerRequest.post(`/api/dashboard/channels/${temporaryChannelId}/submit`);
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    const approvedChannel = await adminRequest.post(`/api/admin/channels/${temporaryChannelId}/review`, {
      data: { decision: "approved", note: "Task 5 privacy acceptance" }
    });
    expect(approvedChannel.ok(), await approvedChannel.text()).toBeTruthy();
    const hiddenJoin = await rejectedRequest.post(`/api/channels/${slug}/join-requests`);
    const missingJoin = await rejectedRequest.post("/api/channels/definitely-missing-private/join-requests");
    expect(hiddenJoin.status()).toBe(404);
    expect(missingJoin.status()).toBe(404);
    const hiddenLeave = await rejectedRequest.delete(`/api/channels/${slug}/membership`);
    const missingLeave = await rejectedRequest.delete("/api/channels/definitely-missing-private/membership");
    expect(hiddenLeave.status()).toBe(404);
    expect(missingLeave.status()).toBe(404);
    const discoverable = await ownerRequest.patch(`/api/dashboard/channels/${temporaryChannelId}`, {
      data: { discoverability: "discoverable" }
    });
    expect(discoverable.ok(), await discoverable.text()).toBeTruthy();
    const temporaryJoin = await rejectedRequest.post(`/api/channels/${slug}/join-requests`);
    expect(temporaryJoin.ok(), await temporaryJoin.text()).toBeTruthy();
    const temporaryMembership = (await temporaryJoin.json()).membership;
    const temporaryApproved = await ownerRequest.post(
      `/api/dashboard/channels/${temporaryChannelId}/members`,
      { data: { membershipId: temporaryMembership.id, decision: "approved" } }
    );
    expect(temporaryApproved.ok(), await temporaryApproved.text()).toBeTruthy();
    const hiddenAgain = await ownerRequest.patch(`/api/dashboard/channels/${temporaryChannelId}`, {
      data: { discoverability: "hidden" }
    });
    expect(hiddenAgain.ok(), await hiddenAgain.text()).toBeTruthy();
    const firstHiddenLeave = await rejectedRequest.delete(`/api/channels/${slug}/membership`);
    expect(firstHiddenLeave.ok(), await firstHiddenLeave.text()).toBeTruthy();
    expect(await firstHiddenLeave.json()).toMatchObject({ changed: true });
    const repeatedHiddenLeave = await rejectedRequest.delete(`/api/channels/${slug}/membership`);
    expect(repeatedHiddenLeave.ok(), await repeatedHiddenLeave.text()).toBeTruthy();
    expect(await repeatedHiddenLeave.json()).toMatchObject({
      changed: false,
      membership: { id: temporaryMembership.id, status: "removed" }
    });
    const neverMemberHiddenLeave = await memberRequest.delete(`/api/channels/${slug}/membership`);
    expect(neverMemberHiddenLeave.status(), await neverMemberHiddenLeave.text()).toBe(404);
    const rediscovered = await ownerRequest.patch(`/api/dashboard/channels/${temporaryChannelId}`, {
      data: { discoverability: "discoverable" }
    });
    expect(rediscovered.ok(), await rediscovered.text()).toBeTruthy();
    const suspended = await adminRequest.post(`/api/admin/channels/${temporaryChannelId}/suspend`);
    expect(suspended.ok(), await suspended.text()).toBeTruthy();
    const suspendedJoin = await rejectedRequest.post(`/api/channels/${slug}/join-requests`);
    expect(suspendedJoin.status()).toBe(404);
  } finally {
    if (temporaryChannelId) {
      try {
        await adminRequest.patch(`/api/admin/channels/${temporaryChannelId}`, {
          data: { status: "archived" }
        });
      } catch {
        // Database cleanup below remains authoritative for dynamic memberships.
      }
    }
    if (cleanupEmails.length) await cleanupPhase7MembershipArtifacts(cleanupEmails);
    await ownerRequest.dispose();
    await editorRequest.dispose();
    await memberRequest.dispose();
    await rejectedRequest.dispose();
    await adminRequest.dispose();
  }
});

test("phase 7 invitation acceptance binds session email and does not unlock paid media", async ({}, testInfo) => {
  const probe = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(probe, testInfo);
  } finally {
    await probe.dispose();
  }

  const ownerRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const inviteeRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const wrongRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const rejectedRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const expiredAcceptRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const expiredRejectRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const reissueRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const rateRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const mediaCreatorRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const cleanupEmails: string[] = [];
  const cleanupAssetIds: string[] = [];
  try {
    await signInCreator(ownerRequest, "chenmo");
    const invitee = await registerFan(inviteeRequest, "phase7-invite");
    const wrong = await registerFan(wrongRequest, "phase7-wrong");
    const rejectedUser = await registerFan(rejectedRequest, "phase7-invite-reject");
    const expiredAcceptUser = await registerFan(expiredAcceptRequest, "phase7-exp-accept");
    const expiredRejectUser = await registerFan(expiredRejectRequest, "phase7-exp-reject");
    const reissueUser = await registerFan(reissueRequest, "phase7-reissue");
    const rateUser = await registerFan(rateRequest, "phase7-invite-rate");
    cleanupEmails.push(
      invitee.email,
      wrong.email,
      rejectedUser.email,
      expiredAcceptUser.email,
      expiredRejectUser.email,
      reissueUser.email,
      rateUser.email
    );
    await signInCreator(mediaCreatorRequest);

    const forged = await ownerRequest.post("/api/dashboard/channels/channel-private-curators/invitations", {
      data: { email: invitee.email, invitedByUserId: "c1" }
    });
    expect(forged.status(), await forged.text()).toBe(400);
    const forgedQuery = await ownerRequest.post(
      "/api/dashboard/channels/channel-private-curators/invitations?anything=forged",
      { data: { email: invitee.email } }
    );
    expect(forgedQuery.status(), await forgedQuery.text()).toBe(400);
    const created = await ownerRequest.post("/api/dashboard/channels/channel-private-curators/invitations", {
      data: { email: ` ${invitee.email.toUpperCase()} ` }
    });
    expect(created.status(), await created.text()).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createdBody.invitation).toMatchObject({ email: invitee.email, status: "pending" });
    expect(createdBody.invitation).not.toHaveProperty("token");
    expect(createdBody.invitation).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(createdBody.invitation)).not.toContain(createdBody.token);

    const wrongEmail = await wrongRequest.post(
      `/api/channels/invitations/${encodeURIComponent(createdBody.token)}`
    );
    expect(wrongEmail.status(), await wrongEmail.text()).toBe(403);
    const concurrent = await Promise.all([
      inviteeRequest.post(`/api/channels/invitations/${encodeURIComponent(createdBody.token)}`),
      inviteeRequest.post(`/api/channels/invitations/${encodeURIComponent(createdBody.token)}`)
    ]);
    expect(concurrent.map((response) => response.status()).sort((left, right) => left - right))
      .toEqual([200, 409]);
    const accepted = concurrent.find((response) => response.status() === 200);
    expect(accepted).toBeDefined();
    expect((await accepted!.json()).membership).toMatchObject({ role: "member", status: "active" });

    const rejectedInvite = await ownerRequest.post(
      "/api/dashboard/channels/channel-private-curators/invitations",
      { data: { email: rejectedUser.email } }
    );
    const rejectedInviteBody = await rejectedInvite.json();
    const rejected = await rejectedRequest.delete(
      `/api/channels/invitations/${encodeURIComponent(rejectedInviteBody.token)}`
    );
    expect(rejected.ok(), await rejected.text()).toBeTruthy();
    const rejectedReplay = await rejectedRequest.delete(
      `/api/channels/invitations/${encodeURIComponent(rejectedInviteBody.token)}`
    );
    expect(rejectedReplay.ok(), await rejectedReplay.text()).toBeTruthy();
    expect((await rejectedReplay.json()).invitation).toMatchObject({ status: "rejected" });

    const expiredAcceptInvite = await ownerRequest.post(
      "/api/dashboard/channels/channel-private-curators/invitations",
      { data: { email: expiredAcceptUser.email } }
    );
    const expiredAcceptBody = await expiredAcceptInvite.json();
    const expiredAcceptNow = Date.now();
    await prisma.channelInvitation.update({
      where: { id: expiredAcceptBody.invitation.id },
      data: {
        createdAt: new Date(expiredAcceptNow - 120_000),
        expiresAt: new Date(expiredAcceptNow - 60_000)
      }
    });
    const expiredAccept = await expiredAcceptRequest.post(
      `/api/channels/invitations/${encodeURIComponent(expiredAcceptBody.token)}`
    );
    expect(expiredAccept.status(), await expiredAccept.text()).toBe(409);
    expect(await prisma.channelInvitation.findUnique({
      where: { id: expiredAcceptBody.invitation.id },
      select: { status: true }
    })).toEqual({ status: "expired" });

    const expiredRejectInvite = await ownerRequest.post(
      "/api/dashboard/channels/channel-private-curators/invitations",
      { data: { email: expiredRejectUser.email } }
    );
    const expiredRejectBody = await expiredRejectInvite.json();
    const expiredRejectNow = Date.now();
    await prisma.channelInvitation.update({
      where: { id: expiredRejectBody.invitation.id },
      data: {
        createdAt: new Date(expiredRejectNow - 120_000),
        expiresAt: new Date(expiredRejectNow - 60_000)
      }
    });
    const expiredReject = await expiredRejectRequest.delete(
      `/api/channels/invitations/${encodeURIComponent(expiredRejectBody.token)}`
    );
    expect(expiredReject.status(), await expiredReject.text()).toBe(409);
    expect(await prisma.channelInvitation.findUnique({
      where: { id: expiredRejectBody.invitation.id },
      select: { status: true }
    })).toEqual({ status: "expired" });

    const firstIssue = await ownerRequest.post(
      "/api/dashboard/channels/channel-private-curators/invitations",
      { data: { email: reissueUser.email } }
    );
    const firstIssueBody = await firstIssue.json();
    const secondIssue = await ownerRequest.post(
      "/api/dashboard/channels/channel-private-curators/invitations",
      { data: { email: reissueUser.email } }
    );
    const secondIssueBody = await secondIssue.json();
    expect(await prisma.channelInvitation.findUnique({
      where: { id: firstIssueBody.invitation.id },
      select: { status: true }
    })).toEqual({ status: "revoked" });
    const revokedReplay = await reissueRequest.post(
      `/api/channels/invitations/${encodeURIComponent(firstIssueBody.token)}`
    );
    expect(revokedReplay.status(), await revokedReplay.text()).toBe(409);
    const rejectCurrent = await reissueRequest.delete(
      `/api/channels/invitations/${encodeURIComponent(secondIssueBody.token)}`
    );
    expect(rejectCurrent.ok(), await rejectCurrent.text()).toBeTruthy();

    const revokeAudits = await prisma.auditLog.findMany({
      where: {
        action: "channel.invitation_revoke",
        targetId: {
          in: [
            firstIssueBody.invitation.id,
            secondIssueBody.invitation.id
          ]
        }
      },
      select: { targetId: true, metadata: true }
    });
    expect(revokeAudits).toHaveLength(1);
    expect(revokeAudits[0]).toMatchObject({
      targetId: firstIssueBody.invitation.id,
      metadata: { channelId: "channel-private-curators", status: "revoked" }
    });

    const transitionAudits = await prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            "channel.invitation_revoke",
            "channel.invitation_expire",
            "channel.invitation_reject"
          ]
        },
        targetId: {
          in: [
            rejectedInviteBody.invitation.id,
            expiredAcceptBody.invitation.id,
            expiredRejectBody.invitation.id,
            firstIssueBody.invitation.id
          ]
        }
      },
      select: { action: true, metadata: true }
    });
    expect(transitionAudits.map(({ action }) => action)).toEqual(expect.arrayContaining([
      "channel.invitation_revoke",
      "channel.invitation_expire",
      "channel.invitation_reject"
    ]));
    for (const audit of transitionAudits) {
      const serialized = JSON.stringify(audit.metadata);
      for (const secret of [
        rejectedInviteBody.token,
        expiredAcceptBody.token,
        expiredRejectBody.token,
        firstIssueBody.token,
        secondIssueBody.token,
        rejectedUser.email,
        expiredAcceptUser.email,
        expiredRejectUser.email,
        reissueUser.email
      ]) {
        expect(serialized).not.toContain(secret);
      }
    }

    const unknownToken = createChannelInvitationToken().token;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const unknown = await rateRequest.post(
        `/api/channels/invitations/${encodeURIComponent(unknownToken)}`
      );
      expect(unknown.status(), await unknown.text()).toBe(404);
    }
    const invitationRateLimited = await rateRequest.post(
      `/api/channels/invitations/${encodeURIComponent(unknownToken)}`
    );
    expect(invitationRateLimited.status(), await invitationRateLimited.text()).toBe(429);

    const prepared = await mediaCreatorRequest.post("/api/uploads/presign", {
      data: {
        fileName: "phase7-membership-entitlement.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100,
        kind: "image",
        visibility: "purchase"
      }
    });
    expect(prepared.ok(), await prepared.text()).toBeTruthy();
    const upload = await prepared.json();
    cleanupAssetIds.push(upload.assetId);
    const completed = await mediaCreatorRequest.post("/api/uploads/complete", {
      data: { assetId: upload.assetId, simulate: true, width: 100, height: 100 }
    });
    expect(completed.ok(), await completed.text()).toBeTruthy();
    expect((await inviteeRequest.get(`/api/media/${upload.assetId}/access`)).status()).toBe(403);
  } finally {
    if (cleanupEmails.length || cleanupAssetIds.length) {
      await cleanupPhase7MembershipArtifacts(cleanupEmails, cleanupAssetIds);
    }
    await ownerRequest.dispose();
    await inviteeRequest.dispose();
    await wrongRequest.dispose();
    await rejectedRequest.dispose();
    await expiredAcceptRequest.dispose();
    await expiredRejectRequest.dispose();
    await reissueRequest.dispose();
    await rateRequest.dispose();
    await mediaCreatorRequest.dispose();
  }
});

test("phase 7 invitation creation enforces the actual 50 per owner hourly route limit", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const probe = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(probe, testInfo);
  } finally {
    await probe.dispose();
  }

  const ownerRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const adminRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const cleanupEmails: string[] = [];
  let channelId: string | null = null;
  let ownerEmail: string | null = null;
  try {
    await signInAdmin(adminRequest);
    const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
    const owner = await registerFan(ownerRequest, "phase7-rate-owner");
    ownerEmail = owner.email;
    cleanupEmails.push(owner.email);
    const promotedOwner = await prisma.user.update({
      where: { email: owner.email },
      data: { role: "creator", creatorStatus: "approved" },
      select: { id: true }
    });
    await prisma.creatorProfile.create({
      data: {
        id: `phase7-rate-profile-${nonce}`,
        userId: promotedOwner.id,
        bio: "Temporary Phase 7 rate-limit creator.",
        category: "Test",
        cover: "cover-1",
        levelId: "level-1"
      }
    });
    const slug = `phase7-invite-rate-${nonce}`;
    const created = await ownerRequest.post("/api/dashboard/channels", {
      data: {
        slug,
        name: "Phase Seven Invitation Rate",
        description: "Temporary isolated invitation creation rate-limit acceptance.",
        visibility: "private",
        discoverability: "hidden",
        memberPostPolicy: "approval_required"
      }
    });
    expect(created.status(), await created.text()).toBe(201);
    channelId = (await created.json()).channel.id;
    const submitted = await ownerRequest.post(`/api/dashboard/channels/${channelId}/submit`);
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    const approved = await adminRequest.post(`/api/admin/channels/${channelId}/review`, {
      data: { decision: "approved", note: "Task 5 invitation rate acceptance" }
    });
    expect(approved.ok(), await approved.text()).toBeTruthy();

    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const email = `phase7-rate-${nonce}-${attempt}@e2e.purehub.local`;
      cleanupEmails.push(email);
      const invitation = await ownerRequest.post(
        `/api/dashboard/channels/${channelId}/invitations`,
        { data: { email } }
      );
      expect(invitation.status(), `attempt ${attempt}: ${await invitation.text()}`).toBe(201);
    }
    const overflowEmail = `phase7-rate-${nonce}-overflow@e2e.purehub.local`;
    cleanupEmails.push(overflowEmail);
    const rateLimited = await ownerRequest.post(
      `/api/dashboard/channels/${channelId}/invitations`,
      { data: { email: overflowEmail } }
    );
    expect(rateLimited.status(), await rateLimited.text()).toBe(429);
  } finally {
    try {
      await cleanupPhase7MembershipArtifacts(
        cleanupEmails,
        [],
        channelId ? [channelId] : []
      );
    } finally {
      if (ownerEmail) {
        await prisma.user.deleteMany({ where: { email: ownerEmail } });
      }
    }
    await ownerRequest.dispose();
    await adminRequest.dispose();
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

test("phase 7 curation and worker routes enforce their authentication boundaries", async ({ request }) => {
  const curation = await request.post("/api/dashboard/channels/channel-yuki-studio/posts", {
    data: { postId: "post-1" }
  });
  expect(curation.status(), await curation.text()).toBe(401);

  const worker = await request.post("/api/internal/phase7/run");
  expect(worker.status(), await worker.text()).toBe(401);
});

test("phase 7 curation validation and durable job helpers are strict and deterministic", () => {
  const version = new Date("2026-07-24T12:34:56.000Z");
  expect(materializeChannelJobKey("channel-1", version))
    .toBe("materialize:channel-1:2026-07-24T12:34:56.000Z");
  expect(indexEntityJobKey("post", "post-1", version))
    .toBe("index:post:post-1:2026-07-24T12:34:56.000Z");
  expect(deleteIndexJobKey("channel", "channel-1", version))
    .toBe("delete-index:channel:channel-1:2026-07-24T12:34:56.000Z");
  expect(reindexAllJobKey(version)).toBe("reindex-all:2026-07-24T12:34:56.000Z");
  expect([1, 2, 7, 8, 9].map(phase7JobBackoffSeconds)).toEqual([30, 60, 1920, 3600, 3600]);

  expect(validateChannelPostMutationInput({
    postId: "post-1",
    position: -2_147_483_648,
    pinned: true
  })).toEqual({ postId: "post-1", position: -2_147_483_648, pinned: true });
  expect(validateChannelPostPatchInput({ position: 2_147_483_647, status: "active" }))
    .toEqual({ position: 2_147_483_647, status: "active" });
  expect(validateChannelRuleMutationInput({ kind: "tag", value: " featured " }))
    .toEqual({ kind: "tag", value: "featured", enabled: true });
  expect(validateChannelExclusionMutationInput({ postId: "post-1", reason: " no match " }))
    .toEqual({ postId: "post-1", reason: "no match" });

  for (const invalid of [
    () => validateChannelPostMutationInput({ postId: "post-1", position: 2_147_483_648 }),
    () => validateChannelPostPatchInput({ status: "pending" }),
    () => validateChannelRuleMutationInput({ kind: "and", value: "x" }),
    () => validateChannelExclusionMutationInput({ postId: "post-1", reason: "", actorId: "fan-demo" })
  ]) {
    expect(invalid).toThrow();
  }
});

test("phase 7 curation resolves manual, member, rule, exclusion, and worker precedence", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const probe = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(probe, testInfo);
  } finally {
    await probe.dispose();
  }

  const ownerRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const editorRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const memberRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const outsiderRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const adminRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const workerRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const channelId = `phase7-curation-${nonce}`;
  const slug = `phase7-curation-${nonce}`;
  const auditTargetIds: string[] = [channelId];
  try {
    await signInCreator(ownerRequest, "chenmo");
    await signInCreator(editorRequest);
    await signInFan(memberRequest);
    await signInCreator(outsiderRequest, "momo");
    await signInAdmin(adminRequest);
    await prisma.channel.create({
      data: {
        id: channelId,
        slug,
        name: "Phase Seven Curation",
        description: "Temporary mixed curation acceptance channel.",
        kind: "creator",
        visibility: "private",
        discoverability: "hidden",
        status: "active",
        ownerUserId: "c2",
        createdByUserId: "c2",
        memberPostPolicy: "direct",
        reviewedByAdminId: "admin-demo",
        reviewedAt: new Date(),
        memberships: {
          create: [
            { userId: "c2", role: "owner", status: "active", reviewedByUserId: "admin-demo", reviewedAt: new Date() },
            { userId: "c1", role: "editor", status: "active", invitedByUserId: "c2", reviewedByUserId: "c2", reviewedAt: new Date() },
            { userId: "fan-demo", role: "member", status: "active", invitedByUserId: "c2", reviewedByUserId: "c2", reviewedAt: new Date() }
          ]
        }
      }
    });

    const manual = await ownerRequest.post(`/api/dashboard/channels/${channelId}/posts`, {
      data: { postId: "post-1", position: 2, pinned: true }
    });
    expect(manual.status(), await manual.text()).toBe(201);
    const manualPost = (await manual.json()).channelPost;
    auditTargetIds.push(manualPost.id);
    expect(manualPost).toMatchObject({ postId: "post-1", source: "manual", status: "active", position: 0 });
    expect(manualPost.pinnedAt).toEqual(expect.any(String));

    const memberOverwrite = await memberRequest.post(`/api/dashboard/channels/${channelId}/posts`, {
      data: { postId: "post-1" }
    });
    expect(memberOverwrite.status(), await memberOverwrite.text()).toBe(409);
    expect(await prisma.channelPost.findUniqueOrThrow({
      where: { channelId_postId: { channelId, postId: "post-1" } },
      select: { source: true, status: true, position: true, addedByUserId: true }
    })).toEqual({ source: "manual", status: "active", position: 0, addedByUserId: "c2" });

    const memberOrdering = await memberRequest.post(`/api/dashboard/channels/${channelId}/posts`, {
      data: { postId: "post-2", position: 1, pinned: true }
    });
    expect(memberOrdering.status(), await memberOrdering.text()).toBe(403);
    expect(await prisma.channelPost.count({ where: { channelId, postId: "post-2" } })).toBe(0);

    const direct = await memberRequest.post(`/api/dashboard/channels/${channelId}/posts`, {
      data: { postId: "post-2" }
    });
    expect(direct.status(), await direct.text()).toBe(201);
    const directPost = (await direct.json()).channelPost;
    auditTargetIds.push(directPost.id);
    expect(directPost).toMatchObject({ postId: "post-2", source: "manual", status: "active" });

    const policy = await ownerRequest.patch(`/api/dashboard/channels/${channelId}`, {
      data: { memberPostPolicy: "approval_required" }
    });
    expect(policy.ok(), await policy.text()).toBeTruthy();
    const pending = await memberRequest.post(`/api/dashboard/channels/${channelId}/posts`, {
      data: { postId: "post-3" }
    });
    expect(pending.status(), await pending.text()).toBe(201);
    const pendingPost = (await pending.json()).channelPost;
    auditTargetIds.push(pendingPost.id);
    expect(pendingPost).toMatchObject({ postId: "post-3", source: "manual", status: "pending" });

    const approved = await editorRequest.patch(
      `/api/dashboard/channels/${channelId}/posts/${pendingPost.id}`,
      { data: { status: "active", position: 3 } }
    );
    expect(approved.ok(), await approved.text()).toBeTruthy();
    expect((await approved.json()).channelPost).toMatchObject({ status: "active", position: 3 });

    const postOne = await prisma.post.findUniqueOrThrow({
      where: { id: "post-1" },
      select: { category: true, tags: true, creatorId: true }
    });
    const firstTag = Array.isArray(postOne.tags)
      ? postOne.tags.find((tag): tag is string => typeof tag === "string")
      : null;
    expect(firstTag).toEqual(expect.any(String));
    for (const rule of [
      { kind: "category", value: postOne.category },
      { kind: "creator", value: postOne.creatorId },
      { kind: "tag", value: firstTag }
    ]) {
      const created = await editorRequest.post(`/api/dashboard/channels/${channelId}/rules`, { data: rule });
      expect(created.status(), await created.text()).toBe(201);
      auditTargetIds.push((await created.json()).rule.id);
    }

    const workerToken = process.env.WORKER_ACCESS_TOKEN;
    expect(workerToken, "WORKER_ACCESS_TOKEN is required for Phase 7 worker acceptance.").toBeTruthy();
    const runWorker = async () => {
      const response = await workerRequest.post("/api/internal/phase7/run", {
        headers: { "x-worker-token": workerToken! }
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    expect(await runWorker()).toMatchObject({
      claimed: expect.any(Number),
      completed: expect.any(Number),
      failed: 0,
      channelMaterialization: {
        claimed: expect.any(Number),
        completed: expect.any(Number),
        failed: 0
      },
      searchIndexing: {
        claimed: expect.any(Number),
        completed: expect.any(Number),
        failed: 0
      }
    });
    expect(await runWorker()).toMatchObject({ failed: 0 });
    expect(await prisma.channelPost.count({ where: { channelId, postId: "post-1" } })).toBe(1);
    expect(await prisma.channelPost.findUniqueOrThrow({
      where: { channelId_postId: { channelId, postId: "post-1" } },
      select: { source: true, status: true }
    })).toEqual({ source: "manual", status: "active" });

    const exclusion = await editorRequest.post(`/api/dashboard/channels/${channelId}/exclusions`, {
      data: { postId: "post-1", reason: "Task 6 exclusion precedence." }
    });
    expect(exclusion.status(), await exclusion.text()).toBe(201);
    const exclusionId = (await exclusion.json()).exclusion.id;
    auditTargetIds.push(exclusionId);
    expect(await prisma.channelPost.findUniqueOrThrow({
      where: { channelId_postId: { channelId, postId: "post-1" } },
      select: { status: true }
    })).toEqual({ status: "removed" });

    await runWorker();
    const removeExclusion = await editorRequest.delete(
      `/api/dashboard/channels/${channelId}/exclusions/${exclusionId}`
    );
    expect(removeExclusion.ok(), await removeExclusion.text()).toBeTruthy();
    await runWorker();
    expect(await prisma.channelPost.findUniqueOrThrow({
      where: { channelId_postId: { channelId, postId: "post-1" } },
      select: { source: true, status: true }
    })).toEqual({ source: "manual", status: "active" });

    const feed = await ownerRequest.get(`/api/dashboard/channels/${channelId}/posts?limit=2`);
    expect(feed.ok(), await feed.text()).toBeTruthy();
    const feedBody = await feed.json();
    expect(feedBody.channelPosts[0]).toMatchObject({ postId: "post-1", position: 0 });
    expect(feedBody.nextCursor).toEqual(expect.any(String));
    const secondFeed = await ownerRequest.get(
      `/api/dashboard/channels/${channelId}/posts?limit=2&cursor=${encodeURIComponent(feedBody.nextCursor)}`
    );
    expect(secondFeed.ok(), await secondFeed.text()).toBeTruthy();
    const secondFeedBody = await secondFeed.json();
    expect(secondFeedBody.channelPosts.map(({ id }: { id: string }) => id))
      .not.toEqual(expect.arrayContaining(feedBody.channelPosts.map(({ id }: { id: string }) => id)));

    await prisma.channel.update({ where: { id: channelId }, data: { status: "suspended", suspendedAt: new Date() } });
    for (const reader of [ownerRequest, editorRequest, adminRequest]) {
      for (const resource of ["posts", "rules", "exclusions"]) {
        const readable = await reader.get(`/api/dashboard/channels/${channelId}/${resource}`);
        expect(readable.ok(), `${resource}: ${await readable.text()}`).toBeTruthy();
      }
    }
    const suspendedMemberRead = await memberRequest.get(`/api/dashboard/channels/${channelId}/posts`);
    expect(suspendedMemberRead.status(), await suspendedMemberRead.text()).toBe(404);
    const blocked = await ownerRequest.post(`/api/dashboard/channels/${channelId}/posts`, {
      data: { postId: "post-4" }
    });
    expect(blocked.status(), await blocked.text()).toBe(409);
    const hiddenInactive = await outsiderRequest.post(`/api/dashboard/channels/${channelId}/posts`, {
      data: { postId: "post-4" }
    });
    const missing = await outsiderRequest.post("/api/dashboard/channels/definitely-missing-curation/posts", {
      data: { postId: "post-4" }
    });
    expect(hiddenInactive.status(), await hiddenInactive.text()).toBe(404);
    expect(missing.status(), await missing.text()).toBe(404);
  } finally {
    const curationRows = await prisma.channelPost.findMany({ where: { channelId }, select: { id: true } });
    const ruleRows = await prisma.channelRule.findMany({ where: { channelId }, select: { id: true } });
    const exclusionRows = await prisma.channelPostExclusion.findMany({ where: { channelId }, select: { id: true } });
    const targets = [
      ...auditTargetIds,
      ...curationRows.map(({ id }) => id),
      ...ruleRows.map(({ id }) => id),
      ...exclusionRows.map(({ id }) => id)
    ];
    await prisma.auditLog.deleteMany({ where: { targetId: { in: targets } } });
    await prisma.channel.deleteMany({ where: { id: channelId } });
    await ownerRequest.dispose();
    await editorRequest.dispose();
    await memberRequest.dispose();
    await outsiderRequest.dispose();
    await adminRequest.dispose();
    await workerRequest.dispose();
  }
});

test("phase 7 concurrent materializers claim once and exclusions remain authoritative", async ({}, testInfo) => {
  const probe = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(probe, testInfo);
  } finally {
    await probe.dispose();
  }
  const ownerRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const workerA = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const workerB = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const channelId = `phase7-race-${nonce}`;
  const firstJobKey = `materialize:${channelId}:2026-07-24T00:00:00.000Z`;
  const secondJobKey = `materialize:${channelId}:2026-07-24T00:00:01.000Z`;
  const transientExclusionIds: string[] = [];
  try {
    await signInCreator(ownerRequest, "chenmo");
    const post = await prisma.post.findUniqueOrThrow({
      where: { id: "post-1" },
      select: { category: true }
    });
    await prisma.channel.create({
      data: {
        id: channelId,
        slug: `phase7-race-${nonce}`,
        name: "Phase Seven Curation Race",
        description: "Temporary concurrent materialization acceptance channel.",
        kind: "creator",
        visibility: "private",
        discoverability: "hidden",
        status: "active",
        ownerUserId: "c2",
        createdByUserId: "c2",
        reviewedByAdminId: "admin-demo",
        reviewedAt: new Date(),
        memberships: {
          create: { userId: "c2", role: "owner", status: "active", reviewedByUserId: "admin-demo", reviewedAt: new Date() }
        },
        rules: {
          create: { kind: "category", value: post.category, enabled: true, createdByUserId: "c2" }
        },
        jobs: {
          create: { idempotencyKey: firstJobKey, kind: "materialize_channel" }
        }
      }
    });
    const workerToken = process.env.WORKER_ACCESS_TOKEN;
    expect(workerToken, "WORKER_ACCESS_TOKEN is required for Phase 7 worker acceptance.").toBeTruthy();
    const headers = { "x-worker-token": workerToken! };
    const [firstRun, secondRun] = await Promise.all([
      workerA.post("/api/internal/phase7/run?limit=1", { headers }),
      workerB.post("/api/internal/phase7/run?limit=1", { headers })
    ]);
    expect(firstRun.ok(), await firstRun.text()).toBeTruthy();
    expect(secondRun.ok(), await secondRun.text()).toBeTruthy();
    expect(await prisma.channelJob.findUniqueOrThrow({
      where: { idempotencyKey: firstJobKey },
      select: { status: true, attempts: true }
    })).toEqual({ status: "completed", attempts: 1 });
    expect(await prisma.channelPost.count({ where: { channelId, postId: "post-1" } })).toBe(1);

    await prisma.channelPost.deleteMany({ where: { channelId } });
    await prisma.channelJob.create({
      data: { idempotencyKey: secondJobKey, kind: "materialize_channel", channelId }
    });
    const [excluded, materialized] = await Promise.all([
      ownerRequest.post(`/api/dashboard/channels/${channelId}/exclusions`, {
        data: { postId: "post-1", reason: "Concurrent exclusion must win." }
      }),
      workerA.post("/api/internal/phase7/run?limit=1", { headers })
    ]);
    expect(excluded.status(), await excluded.text()).toBe(201);
    const exclusionId = (await excluded.json()).exclusion.id;
    transientExclusionIds.push(exclusionId);
    expect(materialized.ok(), await materialized.text()).toBeTruthy();
    expect(await prisma.channelPostExclusion.count({ where: { channelId, postId: "post-1" } })).toBe(1);
    const resolved = await prisma.channelPost.findUnique({
      where: { channelId_postId: { channelId, postId: "post-1" } },
      select: { status: true }
    });
    expect(resolved === null || resolved.status === "removed").toBeTruthy();

    const removeExclusion = await ownerRequest.delete(
      `/api/dashboard/channels/${channelId}/exclusions/${exclusionId}`
    );
    expect(removeExclusion.ok(), await removeExclusion.text()).toBeTruthy();
    await prisma.channelPost.deleteMany({ where: { channelId, postId: "post-1" } });
    const [manualRace, exclusionRace] = await Promise.all([
      ownerRequest.post(`/api/dashboard/channels/${channelId}/posts`, {
        data: { postId: "post-1", position: 0 }
      }),
      ownerRequest.post(`/api/dashboard/channels/${channelId}/exclusions`, {
        data: { postId: "post-1", reason: "Concurrent manual exclusion must win." }
      })
    ]);
    expect(exclusionRace.status(), await exclusionRace.text()).toBe(201);
    transientExclusionIds.push((await exclusionRace.json()).exclusion.id);
    expect([201, 409]).toContain(manualRace.status());
    expect(await prisma.channelPostExclusion.count({ where: { channelId, postId: "post-1" } })).toBe(1);
    const manualResolved = await prisma.channelPost.findUnique({
      where: { channelId_postId: { channelId, postId: "post-1" } },
      select: { status: true }
    });
    expect(manualResolved === null || manualResolved.status === "removed").toBeTruthy();
  } finally {
    const [posts, rules, exclusions] = await Promise.all([
      prisma.channelPost.findMany({ where: { channelId }, select: { id: true } }),
      prisma.channelRule.findMany({ where: { channelId }, select: { id: true } }),
      prisma.channelPostExclusion.findMany({ where: { channelId }, select: { id: true } })
    ]);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { targetId: { in: [channelId, ...posts.map(({ id }) => id), ...rules.map(({ id }) => id), ...exclusions.map(({ id }) => id)] } },
          {
            targetId: { in: transientExclusionIds },
            action: { in: ["channel.exclusion_create", "channel.exclusion_delete"] }
          }
        ]
      }
    });
    await prisma.channel.deleteMany({ where: { id: channelId } });
    await ownerRequest.dispose();
    await workerA.dispose();
    await workerB.dispose();
  }
});

test("phase 7 worker retains an eight-attempt terminal failure without leaking its source error", async ({}, testInfo) => {
  const probe = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await requirePhase7(probe, testInfo);
  } finally {
    await probe.dispose();
  }
  const workerRequest = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const nonce = Date.now().toString(36);
  const idempotencyKey = `phase7-terminal-${nonce}`;
  const placeholderKey = `index:post:phase7-placeholder-${nonce}:2026-07-24T00:00:00.000Z`;
  try {
    const job = await prisma.channelJob.create({
      data: {
        idempotencyKey,
        kind: "materialize_channel",
        status: "failed",
        attempts: 7,
        availableAt: new Date(0),
        lastError: "source secret must be replaced"
      }
    });
    await prisma.channelJob.create({
      data: {
        idempotencyKey: placeholderKey,
        kind: "index_entity",
        entityType: "post",
        entityId: `phase7-placeholder-${nonce}`
      }
    });
    const workerToken = process.env.WORKER_ACCESS_TOKEN;
    expect(workerToken, "WORKER_ACCESS_TOKEN is required for Phase 7 worker acceptance.").toBeTruthy();
    const run = await workerRequest.post("/api/internal/phase7/run", {
      headers: { "x-worker-token": workerToken! }
    });
    expect(run.ok(), await run.text()).toBeTruthy();
    const terminal = await prisma.channelJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(terminal).toMatchObject({ status: "failed", attempts: 8 });
    expect(terminal.lastError).toBe("Phase 7 job failed after the maximum retry attempts.");
    expect(terminal.lastError).not.toContain("source secret");
    expect(await prisma.channelJob.findUniqueOrThrow({
      where: { idempotencyKey: placeholderKey },
      select: { status: true, attempts: true }
    })).toEqual({ status: "completed", attempts: 1 });
    expect(await prisma.searchDocument.count({
      where: { entityType: "post", entityId: `phase7-placeholder-${nonce}` }
    })).toBe(0);

    const repeated = await workerRequest.post("/api/internal/phase7/run", {
      headers: { "x-worker-token": workerToken! }
    });
    expect(repeated.ok(), await repeated.text()).toBeTruthy();
    expect(await prisma.channelJob.findUniqueOrThrow({
      where: { id: job.id },
      select: { attempts: true }
    })).toEqual({ attempts: 8 });
  } finally {
    await prisma.channelJob.deleteMany({ where: { idempotencyKey: { in: [idempotencyKey, placeholderKey] } } });
    await workerRequest.dispose();
  }
});

test("phase 7 search validation binds stable cursors to normalized query and type", () => {
  const input = normalizeSearchInput({
    query: "  YUKI   Studio ",
    type: "channel",
    limit: 50
  });
  expect(input).toEqual({
    query: "yuki studio",
    type: "channel",
    limit: 50,
    cursor: null
  });

  const cursor = encodeSearchCursor({
    query: input.query,
    type: input.type ?? null,
    rank: 1.25,
    publishedAt: "2026-07-24T00:00:00.000Z",
    entityType: "channel",
    entityId: "channel-yuki-studio"
  });
  expect(parseSearchCursor(cursor, input.query, input.type)).toMatchObject({
    rank: 1.25,
    publishedAt: "2026-07-24T00:00:00.000Z",
    entityType: "channel",
    entityId: "channel-yuki-studio"
  });

  for (const invalid of [
    () => normalizeSearchInput({ query: "x" }),
    () => normalizeSearchInput({ query: "x".repeat(101) }),
    () => normalizeSearchInput({ query: "yuki", type: "member" as never }),
    () => normalizeSearchInput({ query: "yuki", limit: 51 }),
    () => parseSearchCursor("not-base64-json", "yuki studio", "channel"),
    () => parseSearchCursor(cursor, "another query", "channel"),
    () => parseSearchCursor(cursor, "yuki studio", "creator")
  ]) {
    expect(invalid).toThrow(TypeError);
  }
});

test("phase 7 search producer keys and bounded reindex stages are deterministic", () => {
  const version = new Date("2026-07-24T12:34:56.000Z");
  expect(indexSearchEntityJobKey("post", "post-1", version, "index_entity"))
    .toBe("index:post:post-1:2026-07-24T12:34:56.000Z");
  expect(indexSearchEntityJobKey("creator", "c1", version, "delete_index"))
    .toBe("delete-index:creator:c1:2026-07-24T12:34:56.000Z");
  expect(searchEntityEligibilityJobKind(true)).toBe("index_entity");
  expect(searchEntityEligibilityJobKind(false)).toBe("delete_index");

  expect(advanceSearchReindexStage("post-source")).toBe("creator-source");
  expect(advanceSearchReindexStage("creator-source")).toBe("channel-source");
  expect(advanceSearchReindexStage("channel-source")).toBe("post-document");
  expect(advanceSearchReindexStage("post-document")).toBe("creator-document");
  expect(advanceSearchReindexStage("creator-document")).toBe("channel-document");
  expect(advanceSearchReindexStage("channel-document")).toBe("done");
  expect(() => advanceSearchReindexStage("all-at-once")).toThrow(TypeError);

  const lockedAt = new Date("2026-07-24T12:34:56.000Z");
  expect(phase7JobLeaseWhere({
    id: "job-1",
    status: "processing",
    lockedAt,
    attempts: 3
  })).toEqual({
    id: "job-1",
    status: "processing",
    lockedAt,
    attempts: 3
  });
  expect(() => phase7JobLeaseWhere({
    id: "job-1",
    status: "processing",
    lockedAt: null,
    attempts: 3
  })).toThrow(TypeError);
  expect(phase7NextLeaseAvailableAt(
    lockedAt,
    new Date(lockedAt)
  ).getTime()).toBe(lockedAt.getTime() + 1);
});

test("phase 7 search API rejects malformed input and forged identity without database access", async ({ request }) => {
  for (const path of [
    "/api/search?q=",
    "/api/search?q=yuki&q=studio",
    "/api/search?q=x",
    `/api/search?q=${"x".repeat(101)}`,
    "/api/search?q=yuki&type=",
    "/api/search?q=yuki&type=creator&type=channel",
    "/api/search?q=yuki&type=member",
    "/api/search?q=yuki&cursor=",
    "/api/search?q=yuki&cursor=a&cursor=b",
    "/api/search?q=yuki&cursor=not-base64-json",
    "/api/search?q=yuki&limit=",
    "/api/search?q=yuki&limit=1&limit=2",
    "/api/search?q=yuki&userId=c1"
  ]) {
    const response = await request.get(path);
    expect(response.status(), `${path}: ${await response.text()}`).toBe(400);
  }
});

test("phase 7 PostgreSQL search ranks safe entities, paginates, reindexes, and executes jobs", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const anonymous = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const admin = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const concurrentAdmin = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const support = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const worker = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const hiddenId = `phase7-search-hidden-${nonce}`;
  const suspendedId = `phase7-search-suspended-${nonce}`;
  const jobChannelId = `phase7-search-job-${nonce}`;
  const privateLeakId = "post-3";
  const reindexJobs: string[] = [];
  const reindexAuditTargets: string[] = [];
  const auditIds: string[] = [];
  let databaseReady = false;
  try {
    await requirePhase7(anonymous, testInfo);
    databaseReady = true;
    await signInAdmin(admin);
    await signInAdmin(concurrentAdmin);
    await signInSupport(support);

    const unauthenticated = await anonymous.post("/api/admin/search/reindex", {
      headers: { origin: testInfo.project.use.baseURL! },
      data: {}
    });
    expect(unauthenticated.status(), await unauthenticated.text()).toBe(401);
    const forged = await anonymous.post("/api/admin/search/reindex", {
      headers: {
        origin: testInfo.project.use.baseURL!,
        "x-admin-role": "super_admin"
      },
      data: {}
    });
    expect(forged.status(), await forged.text()).toBe(401);
    const forbidden = await support.post("/api/admin/search/reindex", {
      headers: { origin: testInfo.project.use.baseURL! },
      data: {}
    });
    expect(forbidden.status(), await forbidden.text()).toBe(403);
    const foreignOrigin = await admin.post("/api/admin/search/reindex", {
      headers: { origin: "https://attacker.invalid" },
      data: {}
    });
    expect(foreignOrigin.status(), await foreignOrigin.text()).toBe(403);

    const [firstReindex, secondReindex] = await Promise.all([
      admin.post("/api/admin/search/reindex", {
        headers: { origin: testInfo.project.use.baseURL! },
        data: {}
      }),
      concurrentAdmin.post("/api/admin/search/reindex", {
        headers: { origin: testInfo.project.use.baseURL! },
        data: {}
      })
    ]);
    const [firstCandidate, secondCandidate] = await Promise.all([
      firstReindex.json().catch(() => null as unknown),
      secondReindex.json().catch(() => null as unknown)
    ]);
    const returnedJobIds = [firstCandidate, secondCandidate]
      .map((candidate) => {
        if (!candidate || typeof candidate !== "object" || !("job" in candidate)) {
          return null;
        }
        const job = candidate.job;
        if (!job || typeof job !== "object" || !("id" in job)) return null;
        return typeof job.id === "string" ? job.id : null;
      })
      .filter((id): id is string => id !== null);
    reindexJobs.push(...returnedJobIds);
    reindexAuditTargets.push(...returnedJobIds);

    expect([firstReindex.status(), secondReindex.status()].sort()).toEqual([200, 202]);
    expect(firstCandidate).toMatchObject({
      job: { id: expect.any(String) },
      enqueued: expect.any(Boolean)
    });
    expect(secondCandidate).toMatchObject({
      job: { id: expect.any(String) },
      enqueued: expect.any(Boolean)
    });
    type ReindexResponseBody = {
      job: { id: string };
      progress: { stage: string; cursor: string | null };
      enqueued: boolean;
    };
    const firstBody = firstCandidate as ReindexResponseBody;
    const secondBody = secondCandidate as ReindexResponseBody;
    const firstReindexBody = firstBody.enqueued ? firstBody : secondBody;
    const secondReindexBody = firstBody.enqueued ? secondBody : firstBody;
    expect(secondReindexBody.job.id).toBe(firstReindexBody.job.id);
    expect(secondReindexBody.enqueued).toBeFalsy();
    expect(firstReindexBody.progress).toEqual({ stage: "post-source", cursor: null });

    const reindexAudit = await prisma.auditLog.findFirst({
      where: {
        action: "search.reindex",
        targetType: "channel_job",
        targetId: firstReindexBody.job.id
      },
      select: { id: true, metadata: true }
    });
    expect(reindexAudit).not.toBeNull();
    auditIds.push(reindexAudit!.id);
    expect(JSON.stringify(reindexAudit!.metadata)).not.toContain("token");

    const workerToken = process.env.WORKER_ACCESS_TOKEN;
    expect(workerToken, "WORKER_ACCESS_TOKEN is required for Phase 7 search acceptance.").toBeTruthy();
    const runWorker = async () => {
      const response = await worker.post("/api/internal/phase7/run", {
        headers: { "x-worker-token": workerToken! }
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    let reindexState = await prisma.channelJob.findUniqueOrThrow({
      where: { id: firstReindexBody.job.id },
      select: { status: true, attempts: true, entityType: true, entityId: true }
    });
    const progressStates = new Set<string>();
    for (let run = 0; run < 30 && reindexState.status !== "completed"; run += 1) {
      expect(await runWorker()).toMatchObject({ failed: 0 });
      reindexState = await prisma.channelJob.findUniqueOrThrow({
        where: { id: firstReindexBody.job.id },
        select: { status: true, attempts: true, entityType: true, entityId: true }
      });
      progressStates.add(`${reindexState.entityType}:${reindexState.entityId ?? ""}`);
      if (reindexState.status === "pending") expect(reindexState.attempts).toBe(0);
    }
    expect(progressStates.size).toBeGreaterThan(2);
    expect(await prisma.channelJob.findUniqueOrThrow({
      where: { id: firstReindexBody.job.id },
      select: { status: true, attempts: true }
    })).toEqual({ status: "completed", attempts: 1 });

    for (const [query, type, expectedEntityId] of [
      ["Cosplay", "post", "post-1"],
      ["yuki", "creator", "c1"],
      ["Yuki Studio", "channel", "channel-yuki-studio"]
    ] as const) {
      const response = await anonymous.get(
        `/api/search?q=${encodeURIComponent(query)}&type=${type}`
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = await response.json();
      expect(body.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ entityType: type, entityId: expectedEntityId })
      ]));
      expect(body.results.every((result: { entityType: string }) => result.entityType === type)).toBeTruthy();
    }

    const typo = await anonymous.get("/api/search?q=Yki&type=creator");
    expect(typo.ok(), await typo.text()).toBeTruthy();
    expect((await typo.json()).results).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "creator", entityId: "c1" })
    ]));

    const firstPage = await anonymous.get("/api/search?q=Cosplay&limit=1");
    expect(firstPage.ok(), await firstPage.text()).toBeTruthy();
    const firstPageBody = await firstPage.json();
    expect(firstPageBody.results).toHaveLength(1);
    expect(firstPageBody.nextCursor).toEqual(expect.any(String));
    const secondPage = await anonymous.get(
      `/api/search?q=Cosplay&limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor)}`
    );
    expect(secondPage.ok(), await secondPage.text()).toBeTruthy();
    const secondPageBody = await secondPage.json();
    expect(secondPageBody.results.map(({ entityId }: { entityId: string }) => entityId))
      .not.toContain(firstPageBody.results[0].entityId);
    for (const path of [
      `/api/search?q=another&limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor)}`,
      `/api/search?q=Cosplay&type=post&limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor)}`
    ]) {
      const response = await anonymous.get(path);
      expect(response.status(), await response.text()).toBe(400);
    }

    await prisma.$transaction([
      prisma.channel.create({
        data: {
          id: hiddenId,
          slug: hiddenId,
          name: `PHASE7HIDDEN ${nonce}`,
          description: "Hidden private data must not be globally searchable.",
          kind: "creator",
          visibility: "private",
          discoverability: "hidden",
          status: "active",
          ownerUserId: "c1",
          createdByUserId: "c1"
        }
      }),
      prisma.channel.create({
        data: {
          id: suspendedId,
          slug: suspendedId,
          name: `PHASE7SUSPENDED ${nonce}`,
          description: "Suspended data must not be globally searchable.",
          kind: "creator",
          visibility: "public",
          discoverability: "discoverable",
          status: "suspended",
          ownerUserId: "c1",
          createdByUserId: "c1",
          suspendedAt: new Date()
        }
      }),
      prisma.searchDocument.create({
        data: {
          entityType: "post",
          entityId: privateLeakId,
          title: `PHASE7PRIVATELEAK ${nonce}`,
          body: "PRIVATE POST TEXT MUST NEVER APPEAR",
          keywords: "member private",
          publishedAt: new Date()
        }
      })
    ]);
    await prisma.searchDocument.createMany({
      data: [
        {
          entityType: "channel",
          entityId: hiddenId,
          title: `PHASE7HIDDEN ${nonce}`,
          body: "hidden",
          keywords: "hidden private",
          publishedAt: new Date()
        },
        {
          entityType: "channel",
          entityId: suspendedId,
          title: `PHASE7SUSPENDED ${nonce}`,
          body: "suspended",
          keywords: "suspended public",
          publishedAt: new Date()
        }
      ]
    });
    for (const term of ["PHASE7HIDDEN", "PHASE7SUSPENDED", "PHASE7PRIVATELEAK"]) {
      const response = await anonymous.get(`/api/search?q=${term}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      expect((await response.json()).results).toEqual([]);
    }

    const discoverable = await anonymous.get("/api/search?q=Private%20Curators&type=channel");
    expect(discoverable.ok(), await discoverable.text()).toBeTruthy();
    const discoverableResult = (await discoverable.json()).results.find(
      ({ entityId }: { entityId: string }) => entityId === "channel-private-curators"
    );
    expect(discoverableResult).toMatchObject({
      entityType: "channel",
      entityId: "channel-private-curators",
      title: "Private Curators",
      href: "/channels/private-curators"
    });
    expect(JSON.stringify(discoverableResult)).not.toMatch(
      /email|member|kyc|finance|storage|token|private post/i
    );

    await prisma.channel.create({
      data: {
        id: jobChannelId,
        slug: jobChannelId,
        name: `PHASE7JOB ${nonce}`,
        description: "Safe discoverable search job projection.",
        kind: "creator",
        visibility: "private",
        discoverability: "discoverable",
        status: "active",
        ownerUserId: "c1",
        createdByUserId: "c1"
      }
    });
    const indexKey = `index:channel:${jobChannelId}:2026-07-24T00:00:00.000Z`;
    await prisma.channelJob.create({
      data: {
        idempotencyKey: indexKey,
        kind: "index_entity",
        entityType: "channel",
        entityId: jobChannelId
      }
    });
    expect(await runWorker()).toMatchObject({ failed: 0 });
    expect(await prisma.searchDocument.findUnique({
      where: { entityType_entityId: { entityType: "channel", entityId: jobChannelId } },
      select: { title: true, body: true, keywords: true }
    })).toMatchObject({
      title: `PHASE7JOB ${nonce}`,
      body: "Safe discoverable search job projection."
    });

    await prisma.channel.update({
      where: { id: jobChannelId },
      data: { discoverability: "hidden" }
    });
    const deleteKey = `delete-index:channel:${jobChannelId}:2026-07-24T00:00:01.000Z`;
    await prisma.channelJob.create({
      data: {
        idempotencyKey: deleteKey,
        kind: "delete_index",
        entityType: "channel",
        entityId: jobChannelId
      }
    });
    expect(await runWorker()).toMatchObject({ failed: 0 });
    expect(await prisma.searchDocument.count({
      where: { entityType: "channel", entityId: jobChannelId }
    })).toBe(0);
  } finally {
    const channels = [hiddenId, suspendedId, jobChannelId];
    if (databaseReady) {
      const uniqueAuditIds = [...new Set(auditIds)];
      const uniqueReindexAuditTargets = [...new Set(reindexAuditTargets)];
      const uniqueReindexJobs = [...new Set(reindexJobs)];
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { id: { in: uniqueAuditIds } },
            { targetId: { in: channels } },
            { targetId: { in: uniqueReindexAuditTargets } }
          ]
        }
      });
      await prisma.searchDocument.deleteMany({
        where: {
          OR: [
            { entityType: "post", entityId: privateLeakId },
            { entityType: "channel", entityId: { in: channels } }
          ]
        }
      });
      await prisma.channelJob.deleteMany({
        where: {
          OR: [
            { id: { in: uniqueReindexJobs } },
            { entityId: { in: channels } }
          ]
        }
      });
      await prisma.channel.deleteMany({ where: { id: { in: channels } } });
    }
    await anonymous.dispose();
    await admin.dispose();
    await concurrentAdmin.dispose();
    await support.dispose();
    await worker.dispose();
  }
});

test("phase 7 search producers, leases, retries, and interleavings converge durably", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const probe = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const worker = await playwrightRequest.newContext({ baseURL: testInfo.project.use.baseURL });
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const fanId = `phase7-search-fan-${nonce}`;
  const creatorId = `phase7-search-creator-${nonce}`;
  const applicationId = `phase7-search-application-${nonce}`;
  const channelId = `phase7-search-interleave-${nonce}`;
  const recentLeaseKey = `index:channel:${channelId}:recent-${nonce}`;
  const retryKey = `index:post:missing-${nonce}:2026-07-24T00:00:00.000Z`;
  const reindexKey = `reindex-all:interleave-${nonce}`;
  const maxAttemptKey = `index:channel:${channelId}:max-attempt-${nonce}`;
  const createdPostIds: string[] = [];
  const testStartedAt = new Date();
  let databaseReady = false;
  try {
    await requirePhase7(probe, testInfo);
    databaseReady = true;
    await prisma.user.create({
      data: {
        id: fanId,
        name: "Phase 7 Search Fan",
        handle: fanId,
        email: `${fanId}@purehub.local`,
        avatar: "S",
        role: "fan",
        creatorStatus: "none"
      }
    });
    const freePost = await createPost({
      creatorId: "c1",
      title: `PHASE7 SEARCH PUBLIC ${nonce}`,
      excerpt: "A public search producer acceptance excerpt.",
      content: "A sufficiently long public search producer acceptance body.",
      category: "Cosplay",
      visibility: "free",
      contentType: "photo_short",
      saleMode: "subscription_only"
    });
    createdPostIds.push(freePost.id);
    const memberPost = await createPost({
      creatorId: "c1",
      title: `PHASE7 SEARCH PRIVATE ${nonce}`,
      excerpt: "A private search producer acceptance excerpt.",
      content: "A sufficiently long private search producer acceptance body.",
      category: "Cosplay",
      visibility: "members",
      contentType: "photo_short",
      saleMode: "subscription_only"
    });
    createdPostIds.push(memberPost.id);
    expect(await prisma.channelJob.count({
      where: { entityType: "post", entityId: freePost.id, kind: "index_entity" }
    })).toBe(1);
    expect(await prisma.channelJob.count({
      where: { entityType: "post", entityId: memberPost.id, kind: "delete_index" }
    })).toBe(1);

    const workerToken = process.env.WORKER_ACCESS_TOKEN;
    expect(workerToken, "WORKER_ACCESS_TOKEN is required for producer acceptance.").toBeTruthy();
    const runWorker = async (limit = 25) => {
      const response = await worker.post(`/api/internal/phase7/run?limit=${limit}`, {
        headers: { "x-worker-token": workerToken! }
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    expect(await runWorker()).toMatchObject({ failed: 0 });
    expect(await prisma.searchDocument.count({
      where: { entityType: "post", entityId: freePost.id }
    })).toBe(1);
    expect(await prisma.searchDocument.count({
      where: { entityType: "post", entityId: memberPost.id }
    })).toBe(0);

    await setLike(fanId, freePost.id, true);
    expect(await prisma.channelJob.count({
      where: { entityType: "post", entityId: freePost.id, status: "pending" }
    })).toBeGreaterThan(0);
    await runWorker();
    const [postState, postDocument] = await Promise.all([
      prisma.post.findUniqueOrThrow({ where: { id: freePost.id }, select: { likes: true } }),
      prisma.searchDocument.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: "post", entityId: freePost.id } },
        select: { popularityScore: true }
      })
    ]);
    expect(postDocument.popularityScore).toBe(postState.likes);

    await setFollow(fanId, "yuki", true);
    expect(await prisma.channelJob.count({
      where: { entityType: "creator", entityId: "c1", status: "pending" }
    })).toBeGreaterThan(0);
    await runWorker();
    const [profileState, creatorDocument] = await Promise.all([
      prisma.creatorProfile.findUniqueOrThrow({ where: { userId: "c1" }, select: { followers: true } }),
      prisma.searchDocument.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: "creator", entityId: "c1" } },
        select: { popularityScore: true }
      })
    ]);
    expect(creatorDocument.popularityScore).toBe(profileState.followers);

    await prisma.user.create({
      data: {
        id: creatorId,
        name: `PHASE7 CREATOR ${nonce}`,
        handle: creatorId,
        email: `${creatorId}@purehub.local`,
        avatar: "C",
        role: "fan",
        creatorStatus: "pending"
      }
    });
    await prisma.creatorApplication.create({
      data: {
        id: applicationId,
        userId: creatorId,
        status: "pending",
        displayName: `PHASE7 CREATOR ${nonce}`,
        category: "Cosplay",
        portfolio: "https://example.invalid/phase7-search",
        contact: "phase7-search",
        note: "Safe searchable creator biography."
      }
    });
    const adminContext = { actorUserId: "admin-demo", role: "super_admin" as const };
    await reviewApplicationFromAdmin(adminContext, applicationId, "approved");
    expect(await prisma.channelJob.count({
      where: { entityType: "creator", entityId: creatorId, kind: "index_entity" }
    })).toBe(1);
    await runWorker();
    expect(await prisma.searchDocument.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: "creator", entityId: creatorId } },
      select: { title: true, body: true }
    })).toEqual({
      title: `PHASE7 CREATOR ${nonce}`,
      body: "Safe searchable creator biography."
    });
    await reviewApplicationFromAdmin(adminContext, applicationId, "rejected");
    expect(await prisma.channelJob.count({
      where: { entityType: "creator", entityId: creatorId, kind: "delete_index" }
    })).toBe(1);
    await runWorker();
    expect(await prisma.searchDocument.count({
      where: { entityType: "creator", entityId: creatorId }
    })).toBe(0);

    await prisma.channel.create({
      data: {
        id: channelId,
        slug: channelId,
        name: `PHASE7 INTERLEAVE ${nonce}`,
        description: "Reindex document convergence acceptance.",
        kind: "creator",
        visibility: "private",
        discoverability: "hidden",
        status: "active",
        ownerUserId: "c1",
        createdByUserId: "c1"
      }
    });
    await prisma.searchDocument.create({
      data: {
        entityType: "channel",
        entityId: channelId,
        title: `STALE PHASE7 INTERLEAVE ${nonce}`,
        body: "Stale document content.",
        keywords: "stale hidden",
        publishedAt: new Date()
      }
    });
    await prisma.channelJob.create({
      data: {
        idempotencyKey: reindexKey,
        kind: "reindex_all",
        entityType: "channel-document"
      }
    });
    await prisma.$transaction(async (tx) => {
      const updated = await tx.channel.update({
        where: { id: channelId },
        data: { visibility: "public", discoverability: "discoverable" }
      });
      await enqueueSearchEntitySync(tx, {
        entityType: "channel",
        entityId: channelId,
        sourceUpdatedAt: updated.updatedAt,
        eligible: true
      });
    });
    expect(await runWorker(1)).toMatchObject({ failed: 0 });
    expect(await prisma.searchDocument.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: "channel", entityId: channelId } },
      select: { title: true, body: true }
    })).toEqual({
      title: `PHASE7 INTERLEAVE ${nonce}`,
      body: "Reindex document convergence acceptance."
    });

    const expiredLease = await prisma.channelJob.create({
      data: {
        idempotencyKey: `index:channel:${channelId}:expired-${nonce}`,
        kind: "index_entity",
        entityType: "channel",
        entityId: channelId,
        status: "processing",
        attempts: 1,
        lockedAt: new Date(0)
      }
    });
    const recentLease = await prisma.channelJob.create({
      data: {
        idempotencyKey: recentLeaseKey,
        kind: "index_entity",
        entityType: "channel",
        entityId: channelId,
        status: "processing",
        attempts: 1,
        lockedAt: new Date()
      }
    });
    await runWorker();
    expect(await prisma.channelJob.findUniqueOrThrow({
      where: { id: expiredLease.id },
      select: { status: true, attempts: true, lockedAt: true }
    })).toMatchObject({ status: "completed", attempts: 2, lockedAt: null });
    expect(await prisma.channelJob.findUniqueOrThrow({
      where: { id: recentLease.id },
      select: { status: true, attempts: true }
    })).toEqual({ status: "processing", attempts: 1 });

    const staleLockedAt = new Date("2026-07-24T00:00:00.000Z");
    const reclaimedLockedAt = new Date("2026-07-24T00:10:00.000Z");
    const staleOutcomes = [
      { kind: "completed" as const },
      {
        kind: "progress" as const,
        stage: "creator-source",
        cursor: "c1"
      },
      { kind: "failed" as const }
    ];
    for (const [index, outcome] of staleOutcomes.entries()) {
      const row = await prisma.channelJob.create({
        data: {
          idempotencyKey: `index:channel:${channelId}:stale-${index}-${nonce}`,
          kind: "index_entity",
          entityType: "channel",
          entityId: channelId,
          status: "processing",
          attempts: 2,
          lockedAt: staleLockedAt
        }
      });
      const staleLease = {
        id: row.id,
        status: row.status,
        lockedAt: row.lockedAt,
        attempts: row.attempts
      };
      await prisma.channelJob.update({
        where: { id: row.id },
        data: { attempts: 3, lockedAt: reclaimedLockedAt }
      });
      expect(await settlePhase7JobLease(staleLease, outcome)).toBeFalsy();
      expect(await prisma.channelJob.findUniqueOrThrow({
        where: { id: row.id },
        select: {
          status: true,
          attempts: true,
          lockedAt: true,
          entityType: true,
          entityId: true
        }
      })).toEqual({
        status: "processing",
        attempts: 3,
        lockedAt: reclaimedLockedAt,
        entityType: "channel",
        entityId: channelId
      });
    }

    const maxAttempt = await prisma.channelJob.create({
      data: {
        idempotencyKey: maxAttemptKey,
        kind: "index_entity",
        entityType: "channel",
        entityId: channelId,
        status: "processing",
        attempts: 8,
        lockedAt: new Date(0),
        lastError: "stale source detail"
      }
    });
    await runWorker();
    expect(await prisma.channelJob.findUniqueOrThrow({
      where: { id: maxAttempt.id },
      select: { status: true, attempts: true, lockedAt: true, lastError: true }
    })).toEqual({
      status: "failed",
      attempts: 8,
      lockedAt: null,
      lastError: "Phase 7 job failed after the maximum retry attempts."
    });

    const retry = await prisma.channelJob.create({
      data: {
        idempotencyKey: retryKey,
        kind: "index_entity",
        entityType: "post"
      }
    });
    await runWorker();
    expect(await prisma.channelJob.findUniqueOrThrow({
      where: { id: retry.id },
      select: { status: true, attempts: true, lastError: true }
    })).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "Phase 7 job execution failed and is scheduled for retry."
    });
  } finally {
    if (databaseReady) {
      await setFollow(fanId, "yuki", false).catch(() => undefined);
      await setLike(fanId, createdPostIds[0] ?? "missing", false).catch(() => undefined);
      await synchronizeSearchEntity("creator", "c1").catch(() => undefined);
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { targetId: applicationId },
            { targetId: creatorId },
            { targetId: channelId }
          ]
        }
      });
      await prisma.channelJob.deleteMany({
        where: {
          OR: [
            { entityId: { in: [fanId, creatorId, channelId, ...createdPostIds] } },
            { idempotencyKey: { in: [recentLeaseKey, retryKey, reindexKey, maxAttemptKey] } },
            { entityType: "creator", entityId: "c1", createdAt: { gte: testStartedAt } }
          ]
        }
      });
      await prisma.searchDocument.deleteMany({
        where: {
          OR: [
            { entityType: "creator", entityId: creatorId },
            { entityType: "channel", entityId: channelId },
            { entityType: "post", entityId: { in: createdPostIds } }
          ]
        }
      });
      await prisma.notification.deleteMany({
        where: { actorUserId: fanId }
      });
      await prisma.postLike.deleteMany({ where: { userId: fanId } });
      await prisma.follow.deleteMany({ where: { userId: fanId } });
      await prisma.post.deleteMany({ where: { id: { in: createdPostIds } } });
      await prisma.creatorApplication.deleteMany({ where: { id: applicationId } });
      await prisma.creatorProfile.deleteMany({ where: { userId: creatorId } });
      await prisma.channel.deleteMany({ where: { id: channelId } });
      await prisma.user.deleteMany({ where: { id: { in: [fanId, creatorId] } } });
    }
    await probe.dispose();
    await worker.dispose();
  }
});

test("phase 7 channel UI and search UI expose responsive public routes", async ({ page }) => {
  await page.goto("/channels");
  await expect(page.getByRole("heading", { name: "探索频道" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  if (page.viewportSize()!.width < 640) {
    await expect(page.getByRole("link", { name: "成为博主" })).toBeVisible();
    await expect(page.getByRole("link", { name: "搜索" })).toBeVisible();
  }

  await page.goto("/search?q=yuki");
  await expect(page.getByRole("heading", { name: "统一搜索" })).toBeVisible();
  for (const tab of ["全部", "作品", "创作者", "频道"]) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible();
  }
  const allTab = page.getByRole("tab", { name: "全部" });
  await allTab.focus();
  await allTab.press("End");
  await expect(page.getByRole("tab", { name: "频道" })).toBeFocused();
  await expect(page).toHaveURL(/type=channel/);
  await page.getByRole("tab", { name: "频道" }).press("Home");
  await expect(page.getByRole("tab", { name: "全部" })).toBeFocused();
});

test("phase 7 channel UI ignores stale kind responses and search UI syncs URL input", async ({ page }) => {
  let markCreatorStarted!: () => void;
  const creatorStarted = new Promise<void>((resolve) => {
    markCreatorStarted = resolve;
  });
  let officialAttempts = 0;
  const requestedKinds: Array<string | null> = [];
  const channelRoute = "**/api/channels?*";
  await page.route(channelRoute, async (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind");
    requestedKinds.push(kind);
    if (kind === "official" && officialAttempts++ === 0) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Deterministic channel directory failure." })
      });
      return;
    }
    if (kind === "creator") {
      markCreatorStarted();
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          channels: [{
            slug: "stale-creator",
            name: "Stale Creator Result",
            description: "Safe private summary fixture.",
            kind: "creator",
            visibility: "private",
            discoverability: "discoverable",
            status: "active"
          }],
          nextCursor: null
        })
      }).catch(() => undefined);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        channels: [{
          slug: kind === "official" ? "recovered-official" : "current-all",
          name: kind === "official" ? "Recovered Official Result" : "Current All Result",
          description: "Safe private summary fixture.",
          kind: "official",
          visibility: "private",
          discoverability: "discoverable",
          status: "active"
        }],
        nextCursor: null
      })
    });
  });

  await page.goto("/channels");
  await page.getByRole("button", { name: "官方" }).click();
  await expect(page.getByText("频道目录暂时无法使用。")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试加载频道" })).toBeVisible();
  expect(requestedKinds).toEqual(["official"]);
  await page.getByRole("button", { name: "重试加载频道" }).click();
  await expect(page.getByText("Recovered Official Result")).toBeVisible();
  expect(requestedKinds.slice(0, 2)).toEqual(["official", "official"]);

  await page.getByRole("button", { name: "创作者" }).click();
  await creatorStarted;
  await page.getByRole("button", { name: "全部" }).click();
  await expect(page.getByText("Current All Result")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText("Stale Creator Result")).toHaveCount(0);
  expect(requestedKinds.slice(-2)).toEqual(["creator", null]);
  await page.unroute(channelRoute);

  await page.goto("/search?q=yuki");
  await expect(page.getByRole("textbox", { name: "搜索关键词" })).toHaveValue("yuki");
  await page.goto("/search?q=cosplay&type=channel");
  await expect(page.getByRole("textbox", { name: "搜索关键词" })).toHaveValue("cosplay");
});

test("phase 7 channel UI renders safe cards and a member-only private feed", async ({ page, request }, testInfo) => {
  test.skip(!(await hasDatabase(request)), "Phase 7 channel UI requires the seeded PostgreSQL database.");

  await page.goto("/channels");
  await expect(page.getByTestId("channel-card").filter({ hasText: "PureHub Official" })).toBeVisible();
  await expect(page.getByTestId("channel-card").filter({ hasText: "Yuki Studio" })).toBeVisible();
  const privateCard = page.getByTestId("channel-card").filter({ hasText: "Private Curators" });
  await expect(privateCard).toBeVisible();
  await expect(privateCard.getByRole("link", { name: "申请加入" })).toBeVisible();

  await page.goto("/channels/private-curators");
  await expect(page.getByRole("button", { name: "申请加入频道" })).toBeVisible();
  await expect(page.getByTestId("channel-feed")).toHaveCount(0);
  if (testInfo.project.name === "mobile") {
    const width = page.viewportSize()!.width;
    const actionBox = await page.getByRole("button", { name: "申请加入频道" }).boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.x).toBeGreaterThanOrEqual(0);
    expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(width + 1);
  }
  await page.route("**/api/channels/private-curators/join-requests", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary membership failure." })
    });
  });
  await page.getByRole("button", { name: "申请加入频道" }).click();
  await expect(page.getByRole("button", { name: "申请加入频道" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary membership failure." })).toBeVisible();
  await page.unroute("**/api/channels/private-curators/join-requests");

  await signInFan(page.request);
  await page.goto("/channels/private-curators");
  await expect(page.getByTestId("channel-feed")).toBeVisible();
  await expect(page.getByTestId("channel-feed").getByRole("article")).toHaveCount(1);

  if (testInfo.project.name === "mobile") {
    const viewportWidth = page.viewportSize()?.width ?? 393;
    for (const locator of [page.getByTestId("channel-header"), page.getByTestId("channel-feed")]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
    }
  }
});

test("phase 7 channel UI returns not-found for an anonymous hidden private channel", async ({ page, request }, testInfo) => {
  test.skip(!(await hasDatabase(request)), "Phase 7 hidden channel UI requires the seeded PostgreSQL database.");
  const suffix = `${testInfo.project.name}-${Date.now().toString(36)}`;
  const channelId = `phase7-ui-hidden-${suffix}`;
  const slug = `phase7-ui-hidden-${suffix}`.slice(0, 50);

  await prisma.channel.create({
    data: {
      id: channelId,
      slug,
      name: "Hidden UI Fixture",
      description: "This private channel must not leak through the public page.",
      kind: "creator",
      visibility: "private",
      discoverability: "hidden",
      status: "active",
      ownerUserId: "c2",
      createdByUserId: "c2"
    }
  });

  try {
    const apiResponse = await request.get(`/api/channels/${slug}`);
    expect(apiResponse.status(), await apiResponse.text()).toBe(404);
    await page.goto(`/channels/${slug}`);
    await expect(page.getByText("404", { exact: true })).toBeVisible();
    await expect(page.getByText("Hidden UI Fixture")).toHaveCount(0);
  } finally {
    await prisma.channel.deleteMany({ where: { id: channelId } });
  }
});

test("phase 7 channel UI and search UI preserve complete ordered cursor pages", async ({ page, request, browser }, testInfo) => {
  test.skip(!(await hasDatabase(request)), "Phase 7 search UI requires the seeded PostgreSQL database.");
  const nonce = `${testInfo.project.name}-${Date.now().toString(36)}`;
  const query = `uituple${Date.now().toString(36)}`;
  const fixtureChannels = Array.from({ length: 22 }, (_, index) => ({
    id: `phase7-ui-page-${nonce}-${index}`,
    slug: `phase7-ui-page-${nonce}-${index}`.slice(0, 50),
    name: `UI Page ${index.toString().padStart(2, "0")}`,
    description: `${query} deterministic directory pagination fixture ${index}.`,
    kind: "creator",
    visibility: "public",
    discoverability: "discoverable",
    status: "active",
    ownerUserId: "c2",
    createdByUserId: "c2",
    createdAt: new Date(Date.now() + (30 - index) * 1000)
  }));
  const indexedChannels = fixtureChannels.slice(0, 9);

  await prisma.channel.createMany({ data: fixtureChannels });

  try {
    await prisma.searchDocument.createMany({
      data: indexedChannels.map((channel, index) => ({
        entityType: "channel",
        entityId: channel.id,
        title: `${query} channel ${index}`,
        body: `Deterministic ${query} search pagination result ${index}.`,
        keywords: `${query} channel`,
        popularityScore: 0,
        publishedAt: channel.createdAt
      }))
    });
    const expectedDirectory: string[] = [];
    const directoryCursors = new Set<string>();
    let directoryCursor: string | null = null;
    do {
      const params = new URLSearchParams({ kind: "creator", limit: "20" });
      if (directoryCursor) params.set("cursor", directoryCursor);
      const response = await request.get(`/api/channels?${params}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = await response.json();
      expectedDirectory.push(...body.channels.map((channel: { slug: string }) => channel.slug));
      directoryCursor = body.nextCursor;
      if (directoryCursor) {
        expect(directoryCursors.has(directoryCursor), "Channel directory cursor repeated.").toBeFalsy();
        directoryCursors.add(directoryCursor);
      }
    } while (directoryCursor);

    await page.goto("/channels");
    await page.getByRole("button", { name: "创作者" }).click();
    await expect(page.getByTestId("channel-card").first()).toBeVisible();
    while (await page.getByRole("button", { name: "加载更多频道" }).count()) {
      const beforeCount = await page.getByTestId("channel-card").count();
      await page.getByRole("button", { name: "加载更多频道" }).click();
      await expect.poll(() => page.getByTestId("channel-card").count()).toBeGreaterThan(beforeCount);
    }
    const actualDirectory = await page.getByTestId("channel-card")
      .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-channel-slug")));
    expect(actualDirectory).toEqual(expectedDirectory);
    expect(new Set(actualDirectory).size).toBe(actualDirectory.length);
    if (testInfo.project.name === "mobile") {
      const width = page.viewportSize()!.width;
      const cardBox = await page.getByTestId("channel-card").first().boundingBox();
      expect(cardBox).not.toBeNull();
      expect(cardBox!.x).toBeGreaterThanOrEqual(0);
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(width + 1);
    }

    const expectedSearch: string[] = [];
    const searchCursors = new Set<string>();
    let searchCursor: string | null = null;
    do {
      const params = new URLSearchParams({ q: query, type: "channel", limit: "6" });
      if (searchCursor) params.set("cursor", searchCursor);
      const response = await request.get(`/api/search?${params}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = await response.json();
      expectedSearch.push(...body.results.map((result: { entityId: string }) => result.entityId));
      searchCursor = body.nextCursor;
      if (searchCursor) {
        expect(searchCursors.has(searchCursor), "Search cursor repeated.").toBeFalsy();
        searchCursors.add(searchCursor);
      }
    } while (searchCursor);

    await page.goto(`/search?q=${query}&type=channel`);
    const firstResult = page.getByTestId("search-result").first();
    await expect(firstResult).toBeVisible();
    const beforeDocumentY = await firstResult.evaluate(
      (result) => result.getBoundingClientRect().top + window.scrollY
    );
    while (await page.getByRole("button", { name: "加载更多搜索结果" }).count()) {
      const beforeCount = await page.getByTestId("search-result").count();
      await page.getByRole("button", { name: "加载更多搜索结果" }).click();
      await expect.poll(() => page.getByTestId("search-result").count()).toBeGreaterThan(beforeCount);
    }
    const actualSearch = await page.getByTestId("search-result")
      .evaluateAll((results) => results.map((result) => result.getAttribute("data-result-id")));
    expect(actualSearch).toEqual(expectedSearch);
    expect(new Set(actualSearch).size).toBe(actualSearch.length);
    await expect.poll(() => firstResult.evaluate(
      (result) => result.getBoundingClientRect().top + window.scrollY
    )).toBe(beforeDocumentY);

    const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
    const noScriptPage = await noScriptContext.newPage();
    try {
      const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
      await noScriptPage.goto(`${baseURL}/channels`);
      await expect(noScriptPage.locator(`[data-channel-slug="${fixtureChannels[0].slug}"]`)).toBeVisible();
      await noScriptPage.goto(`${baseURL}/search?q=${query}&type=channel`);
      await expect(noScriptPage.locator(`[data-result-id="${indexedChannels[0].id}"]`)).toBeVisible();
    } finally {
      await noScriptContext.close();
    }

    if (testInfo.project.name === "mobile") {
      const viewportWidth = page.viewportSize()?.width ?? 393;
      const widths = await page.locator("html").evaluate((html) => ({
        scrollWidth: html.scrollWidth,
        clientWidth: html.clientWidth
      }));
      expect(widths.scrollWidth).toBe(widths.clientWidth);
      expect(widths.clientWidth).toBe(viewportWidth);
      for (const locator of [
        page.getByRole("tablist", { name: "搜索结果类型" }),
        page.getByTestId("search-result").first()
      ]) {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
      }
    }
  } finally {
    await prisma.searchDocument.deleteMany({ where: { entityId: { in: fixtureChannels.map(({ id }) => id) } } });
    await prisma.channel.deleteMany({ where: { id: { in: fixtureChannels.map(({ id }) => id) } } });
  }
});

test("phase 7 dashboard channel UI redirects fans and separates owner from editor controls", async ({ page, request }, testInfo) => {
  await requirePhase7(request, testInfo);

  await signInFan(page.request);
  await page.goto("/dashboard/channels");
  await expect(page).toHaveURL("/");

  await signInCreator(page.request);
  await page.goto("/dashboard/channels");
  await expect(page.getByRole("heading", { name: "频道管理" })).toBeVisible();
  await expect(page.getByTestId("channel-quota")).toContainText("1 / 3");
  await expect(page.getByTestId("channel-review-status")).toContainText("active");
  await expect(page.getByTestId("channel-owner-controls")).toBeVisible();
  await expect(page.getByTestId("channel-membership-manager")).toBeVisible();
  await expect(page.getByTestId("channel-curation-manager")).toBeVisible();
  await expect(page.getByTestId("channel-policy-control")).toBeVisible();

  await page.getByRole("button", { name: "Private Curators" }).click();
  await expect(page.getByTestId("channel-current-role")).toContainText("editor");
  await expect(page.getByTestId("channel-curation-manager")).toBeVisible();
  await expect(page.getByTestId("channel-owner-controls")).toHaveCount(0);
  await expect(page.getByTestId("channel-membership-manager")).toHaveCount(0);
  await expect(page.getByTestId("channel-policy-control")).toHaveCount(0);
});

test("phase 7 disposable owner operations cover membership invitation policy and curation", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  const owner = await playwrightRequest.newContext({ baseURL });
  const admin = await playwrightRequest.newContext({ baseURL });
  const invitee = await playwrightRequest.newContext({ baseURL });
  const applicant = await playwrightRequest.newContext({ baseURL });
  const cleanupEmails: string[] = [];
  const channelPostIds = new Set<string>();
  const channelRuleIds = new Set<string>();
  const channelExclusionIds = new Set<string>();
  let channelId: string | null = null;
  try {
    await signInCreator(owner);
    await signInAdmin(admin);
    const inviteIdentity = await registerFan(invitee, "phase7-owner-invite");
    const applicantIdentity = await registerFan(applicant, "phase7-owner-join");
    cleanupEmails.push(inviteIdentity.email, applicantIdentity.email);
    const suffix = Date.now().toString(36);
    const created = await owner.post("/api/dashboard/channels", {
      headers: authHeaders,
      data: {
        slug: `owner-ops-${suffix}`,
        name: `Owner Ops ${suffix}`,
        description: "Disposable Task 9 owner operations fixture.",
        visibility: "private",
        discoverability: "discoverable",
        memberPostPolicy: "approval_required"
      }
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    channelId = (await created.json()).channel.id;
    expect((await owner.post(`/api/dashboard/channels/${channelId}/submit`, {
      headers: authHeaders,
      data: {}
    })).ok()).toBeTruthy();
    expect((await admin.post(`/api/admin/channels/${channelId}/review`, {
      headers: authHeaders,
      data: { decision: "approved", note: "Disposable owner operations acceptance." }
    })).ok()).toBeTruthy();

    const policy = await owner.patch(`/api/dashboard/channels/${channelId}`, {
      headers: authHeaders,
      data: { memberPostPolicy: "direct" }
    });
    expect(policy.ok(), await policy.text()).toBeTruthy();

    const invitation = await owner.post(`/api/dashboard/channels/${channelId}/invitations`, {
      headers: authHeaders,
      data: { email: inviteIdentity.email }
    });
    expect(invitation.status(), await invitation.text()).toBe(201);
    expect((await invitation.json()).token).toEqual(expect.any(String));

    const join = await applicant.post(`/api/channels/owner-ops-${suffix}/join-requests`, {
      headers: authHeaders,
      data: {}
    });
    expect(join.ok(), await join.text()).toBeTruthy();
    const pendingMembershipId = (await join.json()).membership.id;
    const approved = await owner.post(`/api/dashboard/channels/${channelId}/members`, {
      headers: authHeaders,
      data: { membershipId: pendingMembershipId, decision: "approved" }
    });
    expect(approved.ok(), await approved.text()).toBeTruthy();

    const posts = await prisma.post.findMany({
      orderBy: { id: "asc" },
      take: 2,
      select: { id: true }
    });
    expect(posts.length).toBeGreaterThanOrEqual(2);
    const added = await owner.post(`/api/dashboard/channels/${channelId}/posts`, {
      headers: authHeaders,
      data: { postId: posts[0].id, position: 0 }
    });
    expect(added.ok(), await added.text()).toBeTruthy();
    const addedBody = await added.json();
    channelPostIds.add(addedBody.channelPost.id);
    expect(addedBody.channelPost.position).toBe(0);
    const rule = await owner.post(`/api/dashboard/channels/${channelId}/rules`, {
      headers: authHeaders,
      data: { kind: "tag", value: `owner-ops-${suffix}`, enabled: true }
    });
    expect(rule.ok(), await rule.text()).toBeTruthy();
    channelRuleIds.add((await rule.json()).rule.id);
    const exclusion = await owner.post(`/api/dashboard/channels/${channelId}/exclusions`, {
      headers: authHeaders,
      data: { postId: posts[1].id, reason: "Disposable owner operations test." }
    });
    expect(exclusion.ok(), await exclusion.text()).toBeTruthy();
    channelExclusionIds.add((await exclusion.json()).exclusion.id);
  } finally {
    try {
      if (channelId) {
        const [posts, rules, exclusions] = await Promise.all([
          prisma.channelPost.findMany({ where: { channelId }, select: { id: true } }),
          prisma.channelRule.findMany({ where: { channelId }, select: { id: true } }),
          prisma.channelPostExclusion.findMany({ where: { channelId }, select: { id: true } })
        ]);
        posts.forEach(({ id }) => channelPostIds.add(id));
        rules.forEach(({ id }) => channelRuleIds.add(id));
        exclusions.forEach(({ id }) => channelExclusionIds.add(id));
      }
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            ...(channelPostIds.size
              ? [{ targetType: "channel_post", targetId: { in: [...channelPostIds] } }]
              : []),
            ...(channelRuleIds.size
              ? [{ targetType: "channel_rule", targetId: { in: [...channelRuleIds] } }]
              : []),
            ...(channelExclusionIds.size
              ? [{ targetType: "channel_exclusion", targetId: { in: [...channelExclusionIds] } }]
              : [])
          ]
        }
      });
    } finally {
      try {
        await cleanupPhase7MembershipArtifacts(cleanupEmails, [], channelId ? [channelId] : []);
      } finally {
        const cleanupUsers = await prisma.user.findMany({
          where: { email: { in: cleanupEmails } },
          select: { id: true }
        });
        const cleanupUserIds = cleanupUsers.map(({ id }) => id);
        if (cleanupUserIds.length) {
          await prisma.$transaction([
            prisma.session.deleteMany({ where: { userId: { in: cleanupUserIds } } }),
            prisma.account.deleteMany({ where: { userId: { in: cleanupUserIds } } }),
            prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } })
          ]);
        }
        await Promise.all([owner.dispose(), admin.dispose(), invitee.dispose(), applicant.dispose()]);
      }
    }
  }
});

test("phase 7 eligible admin manages official memberships without fabricated ownership", async ({ request }, testInfo) => {
  await requirePhase7(request, testInfo);
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  const superAdmin = await playwrightRequest.newContext({ baseURL });
  const contentAdmin = await playwrightRequest.newContext({ baseURL });
  const support = await playwrightRequest.newContext({ baseURL });
  const memberRequest = await playwrightRequest.newContext({ baseURL });
  let channelId: string | null = null;
  let contentAdminUserId: string | null = null;
  const cleanupEmails: string[] = [];
  try {
    await signInAdmin(superAdmin);
    await signInSupport(support);
    const contentIdentity = await registerFan(contentAdmin, "phase7-content-channel");
    const memberIdentity = await registerFan(memberRequest, "phase7-official-member");
    cleanupEmails.push(contentIdentity.email, memberIdentity.email);
    const contentUser = await prisma.user.findUniqueOrThrow({
      where: { email: contentIdentity.email },
      select: { id: true }
    });
    contentAdminUserId = contentUser.id;
    await prisma.$transaction([
      prisma.user.update({ where: { id: contentUser.id }, data: { role: "admin" } }),
      prisma.adminAccount.create({
        data: { userId: contentUser.id, role: "content_admin", status: "active" }
      })
    ]);
    const suffix = Date.now().toString(36);
    const created = await superAdmin.post("/api/admin/channels", {
      headers: authHeaders,
      data: {
        kind: "official",
        slug: `official-members-${suffix}`,
        name: `Official Members ${suffix}`,
        description: "Official membership admin ACL fixture.",
        visibility: "public",
        discoverability: "discoverable",
        memberPostPolicy: "approval_required"
      }
    });
    expect(created.status(), await created.text()).toBe(201);
    channelId = (await created.json()).channel.id;
    const officialChannelId = channelId!;
    const memberUser = await prisma.user.findUniqueOrThrow({
      where: { email: memberIdentity.email },
      select: { id: true }
    });
    const pending = await prisma.channelMembership.create({
      data: { channelId: officialChannelId, userId: memberUser.id, role: "member", status: "pending" }
    });

    const list = await contentAdmin.get(`/api/dashboard/channels/${officialChannelId}/members`, {
      headers: authHeaders
    });
    expect(list.ok(), await list.text()).toBeTruthy();
    expect((await list.json()).memberships.map(({ id }: { id: string }) => id)).toContain(pending.id);
    const review = await contentAdmin.post(`/api/dashboard/channels/${officialChannelId}/members`, {
      headers: authHeaders,
      data: { membershipId: pending.id, decision: "approved" }
    });
    expect(review.ok(), await review.text()).toBeTruthy();
    const roleUpdate = await contentAdmin.patch(`/api/dashboard/channels/${officialChannelId}/members/${pending.id}`, {
      headers: authHeaders,
      data: { role: "editor" }
    });
    expect(roleUpdate.ok(), await roleUpdate.text()).toBeTruthy();
    const deniedList = await support.get(`/api/dashboard/channels/${officialChannelId}/members`, {
      headers: authHeaders
    });
    expect(deniedList.status()).toBe(403);
  } finally {
    await cleanupPhase7MembershipArtifacts(cleanupEmails, [], channelId ? [channelId] : []);
    const cleanupUsers = await prisma.user.findMany({
      where: { email: { in: cleanupEmails } },
      select: { id: true }
    });
    const cleanupUserIds = cleanupUsers.map(({ id }) => id);
    if (contentAdminUserId || cleanupUserIds.length) {
      await prisma.$transaction([
        prisma.adminAccount.deleteMany({ where: { userId: { in: cleanupUserIds } } }),
        prisma.session.deleteMany({ where: { userId: { in: cleanupUserIds } } }),
        prisma.account.deleteMany({ where: { userId: { in: cleanupUserIds } } }),
        prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } })
      ]);
    }
    await Promise.all([superAdmin.dispose(), contentAdmin.dispose(), support.dispose(), memberRequest.dispose()]);
  }
});

test("phase 7 dashboard channel UI renders the protected operations contract", async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  await page.context().addCookies([{
    name: "purehub.session_token",
    value: "phase7-ui-contract",
    url: baseURL
  }]);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "phase7-ui-session", userId: "c1", expiresAt: "2026-07-25T23:59:59.000Z" },
      user: { id: "c1", name: "UI Fixture", email: "fixture@purehub.local" }
    })
  }));

  const channel = (input: {
    id: string;
    name: string;
    slug: string;
    role: "owner" | "editor" | null;
    status?: string;
    ownerUserId?: string;
  }) => ({
    id: input.id,
    slug: input.slug,
    name: input.name,
    description: `${input.name} operations fixture.`,
    avatarAssetId: null,
    coverAssetId: null,
    kind: "creator",
    visibility: "public",
    discoverability: "discoverable",
    status: input.status ?? "active",
    ownerUserId: input.ownerUserId ?? "c1",
    createdByUserId: input.ownerUserId ?? "c1",
    memberPostPolicy: "approval_required",
    reviewNote: null,
    reviewedAt: "2026-07-24T00:00:00.000Z",
    suspendedAt: null,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    owner: { id: input.ownerUserId ?? "c1", name: "Fixture Owner", handle: "fixture-owner", avatar: "" },
    access: {
      canRead: true,
      canManage: input.role === "owner",
      canCurate: input.role === "owner" || input.role === "editor",
      canManageMembers: input.role === "owner",
      role: input.role
    }
  });
  const ownerChannel = channel({ id: "owner-channel", slug: "owner-channel", name: "Owner Channel", role: "owner" });
  const editorChannel = channel({ id: "editor-channel", slug: "editor-channel", name: "Editor Channel", role: "editor", ownerUserId: "c2" });

  await page.route("**/api/dashboard/channels?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ channels: [ownerChannel], nextCursor: null, quota: { used: 1, limit: 3, levelId: "level-2", overridden: false } })
  }));
  await page.route("**/api/channels?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ channels: [ownerChannel, editorChannel], nextCursor: null })
  }));
  await page.route("**/api/dashboard/channels/*/members*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ memberships: [], nextCursor: null })
  }));
  await page.route("**/api/dashboard/channels/*/posts*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ posts: [], nextCursor: null })
  }));
  await page.route("**/api/dashboard/channels/*/rules*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ rules: [], nextCursor: null })
  }));
  await page.route("**/api/dashboard/channels/*/exclusions*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ exclusions: [], nextCursor: null })
  }));

  await page.goto("/dashboard/channels");
  await expect(page.getByRole("heading", { name: "频道管理" })).toBeVisible();
  await expect(page.getByTestId("channel-create-form")).toBeVisible();
  await expect(page.getByTestId("channel-owner-controls")).toBeVisible();
  await expect(page.getByTestId("channel-settings-form")).toBeVisible();
  await page.getByRole("button", { name: "Editor Channel" }).click();
  await expect(page.getByTestId("channel-current-role")).toContainText("editor");
  await expect(page.getByTestId("channel-owner-controls")).toHaveCount(0);
  await expect(page.getByTestId("channel-curation-manager")).toBeVisible();
});

test("phase 7 dashboard channel operations use exact membership, invitation, post, and cursor contracts", async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  const mutations: Array<{ url: string; method: string; body: unknown }> = [];
  let failInvite = false;
  await page.context().addCookies([{ name: "purehub.session_token", value: "phase7-owner-operation-ui", url: baseURL }]);
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "phase7-owner-session", userId: "c1", expiresAt: "2027-07-25T23:59:59.000Z" },
      user: { id: "c1", name: "Owner Fixture", email: "owner@purehub.local" }
    })
  }));
  const ownerChannel = {
    id: "owner-private",
    slug: "owner-private",
    name: "Owner Private",
    description: "Complete channel operation fixture.",
    avatarAssetId: null,
    coverAssetId: null,
    kind: "creator",
    visibility: "private",
    discoverability: "hidden",
    status: "active",
    ownerUserId: "c1",
    createdByUserId: "c1",
    memberPostPolicy: "approval_required",
    reviewNote: null,
    reviewedAt: "2026-07-24T00:00:00.000Z",
    suspendedAt: null,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    owner: { id: "c1", name: "Owner Fixture", handle: "owner", avatar: "" },
    access: { canRead: true, canManage: true, canCurate: true, canManageMembers: true, role: "owner" }
  };
  const membership = (id: string, status: string, role: string, handle: string, userId = id) => ({
    id,
    channelId: ownerChannel.id,
    userId,
    role,
    status,
    invitedByUserId: null,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    user: { id: userId, name: handle, handle, avatar: "" }
  });

  await page.route("**/api/dashboard/channels?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ channels: [ownerChannel], nextCursor: null, quota: { used: 1, limit: 3, levelId: "level-2", overridden: false } })
  }));
  await page.route("**/api/channels?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ channels: [], nextCursor: null })
  }));
  await page.route("**/api/dashboard/channels/owner-private/members?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cursor
        ? { memberships: [membership("member-page-2", "active", "member", "page-two")], nextCursor: null }
        : {
            memberships: [
              membership("owner-row", "active", "owner", "owner", "c1"),
              membership("pending-row", "pending", "member", "pending"),
              membership("active-row", "active", "member", "active"),
              membership("removed-row", "removed", "member", "removed")
            ],
            nextCursor: "members-page-2"
          })
    });
  });
  await page.route("**/api/dashboard/channels/owner-private/posts?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cursor
        ? { channelPosts: [{ id: "active-2", channelId: ownerChannel.id, postId: "post-active-2", source: "manual", status: "active", position: 1, pinnedAt: null }], nextCursor: null }
        : {
            channelPosts: [
              { id: "pending-post", channelId: ownerChannel.id, postId: "post-pending", source: "manual", status: "pending", position: null, pinnedAt: null },
              { id: "active-1", channelId: ownerChannel.id, postId: "post-active-1", source: "manual", status: "active", position: 0, pinnedAt: null },
              { id: "active-null", channelId: ownerChannel.id, postId: "post-active-null", source: "manual", status: "active", position: null, pinnedAt: null },
              { id: "removed-post", channelId: ownerChannel.id, postId: "post-removed", source: "manual", status: "removed", position: null, pinnedAt: null }
            ],
            nextCursor: "posts-page-2"
          })
    });
  });
  for (const [resource, key, cursor] of [
    ["rules", "rules", "rules-page-2"],
    ["exclusions", "exclusions", "exclusions-page-2"]
  ] as const) {
    await page.route(`**/api/dashboard/channels/owner-private/${resource}?*`, (route) => {
      const next = new URL(route.request().url()).searchParams.get("cursor");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          [key]: resource === "rules" && !next
            ? [{ id: "rule-toggle", kind: "tag", value: "featured", enabled: true }]
            : [],
          nextCursor: next ? null : cursor
        })
      });
    });
  }
  await page.route("**/api/dashboard/channels/owner-private/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fallback();
    }
    const body = request.postData() ? request.postDataJSON() : {};
    mutations.push({ url: new URL(request.url()).pathname, method: request.method(), body });
    if (request.url().endsWith("/invitations")) {
      if (failInvite) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "invite failed visibly" })
        });
      }
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          invitation: { id: "invite-1", email: "invitee@example.com", expiresAt: "2026-07-31T00:00:00.000Z" },
          token: "one-time-raw-token"
        })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await page.goto("/dashboard/channels");
  await expect(page.getByText("@page-two")).toBeVisible();
  expect(await page.getByText("page-two").count()).toBeGreaterThan(0);

  await page.getByLabel("邀请邮箱").fill("invitee@example.com");
  await page.getByRole("button", { name: "发送频道邀请" }).click();
  const receipt = page.getByTestId("invitation-receipt");
  await expect(receipt).toContainText("one-time-raw-token");
  await expect(receipt).toContainText("/channels/invitations/one-time-raw-token");
  await expect(receipt).toContainText("只显示一次");
  await expect(receipt.getByRole("button", { name: "复制一次性邀请链接" })).toBeVisible();
  failInvite = true;
  await page.getByLabel("邀请邮箱").fill("failure@example.com");
  await page.getByRole("button", { name: "发送频道邀请" }).click();
  await expect(page.getByText("invite failed visibly")).toBeVisible();
  await expect(page.getByLabel("邀请邮箱")).toHaveValue("failure@example.com");
  failInvite = false;

  await page.getByRole("button", { name: "通过 pending 的加入申请" }).click();
  expect(mutations.at(-1)).toEqual({
    url: "/api/dashboard/channels/owner-private/members",
    method: "POST",
    body: { membershipId: "pending-row", decision: "approved" }
  });
  await page.getByLabel("变更 active 的角色").selectOption("editor");
  expect(mutations.at(-1)).toMatchObject({
    url: "/api/dashboard/channels/owner-private/members/active-row",
    method: "PATCH",
    body: { role: "editor" }
  });
  await expect(page.getByLabel("变更 active 的角色").getByRole("option", { name: "owner" })).toHaveCount(0);
  await expect(page.getByText("所有者受保护")).toBeVisible();

  await page.getByRole("button", { name: "通过作品 post-pending" }).click();
  expect(mutations.at(-1)).toMatchObject({
    url: "/api/dashboard/channels/owner-private/posts/pending-post",
    method: "PATCH",
    body: { status: "active" }
  });
  await page.getByRole("button", { name: "下移作品 post-active-1" }).click();
  expect(mutations.at(-1)).toMatchObject({
    url: "/api/dashboard/channels/owner-private/posts/active-1",
    method: "PATCH",
    body: { position: 1 }
  });
  await page.getByRole("button", { name: "加入排序 post-active-null" }).click();
  expect(mutations.at(-1)).toMatchObject({
    url: "/api/dashboard/channels/owner-private/posts/active-null",
    method: "PATCH",
    body: { position: 2 }
  });
  await page.getByLabel("作品 ID", { exact: true }).fill("post-new-manual");
  await page.getByRole("button", { name: "加入作品" }).click();
  expect(mutations.at(-1)).toMatchObject({
    url: "/api/dashboard/channels/owner-private/posts",
    method: "POST",
    body: { postId: "post-new-manual", position: 2 }
  });
  await page.getByRole("button", { name: "停用规则 featured" }).click();
  expect(mutations.at(-1)).toMatchObject({
    url: "/api/dashboard/channels/owner-private/rules/rule-toggle",
    method: "PATCH",
    body: { enabled: false }
  });
});

test("phase 7 invitation recipient page authenticates and sends explicit accept or reject", async ({ page }) => {
  const calls: Array<{ method: string; body: unknown }> = [];
  let rejectNetworkOnce = false;
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "invite-session", userId: "invite-user", expiresAt: "2027-07-25T00:00:00.000Z" },
      user: { id: "invite-user", name: "Invite User", email: "invitee@example.com" }
    })
  }));
  await page.route("**/api/channels/invitations/recipient-token", async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), body: request.postData() ? request.postDataJSON() : null });
    if (rejectNetworkOnce) {
      rejectNetworkOnce = false;
      return route.abort("failed");
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ changed: true }) });
  });

  await page.goto("/channels/invitations/recipient-token");
  await page.getByRole("button", { name: "接受邀请" }).click();
  await expect(page.getByText("邀请已接受")).toBeVisible();
  expect(calls.at(-1)).toEqual({ method: "POST", body: {} });

  await page.reload();
  await page.getByRole("button", { name: "拒绝邀请" }).click();
  await expect(page.getByText("邀请已拒绝")).toBeVisible();
  expect(calls.at(-1)).toEqual({ method: "DELETE", body: {} });

  rejectNetworkOnce = true;
  await page.reload();
  await page.getByRole("button", { name: "接受邀请" }).click();
  await expect(page.getByText("网络连接失败，请重试邀请操作。")).toBeVisible();
  const retry = page.getByRole("button", { name: "重试接受邀请" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByText("邀请已接受")).toBeVisible();
});

test("phase 7 admin channel operation builders use exact success and failure contracts", async () => {
  expect(officialChannelOperationsAvailable("official", "active")).toBeTruthy();
  for (const status of ["draft", "pending", "rejected", "suspended", "archived"]) {
    expect(officialChannelOperationsAvailable("official", status)).toBeFalsy();
  }
  expect(officialChannelOperationsAvailable("creator", "active")).toBeFalsy();
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null
    });
    if (String(input).endsWith("/takeover")) {
      return new Response(JSON.stringify({ error: "takeover failed visibly" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await executeChannelOperation(adminChannelOperations.quota("owner-two", 7, "contract test"));
    expect(calls.at(-1)).toEqual({
      url: "/api/admin/channels/quotas/owner-two",
      method: "PUT",
      body: { maxChannels: 7, reason: "contract test" }
    });
    await executeChannelOperation(adminChannelOperations.archive("admin-page-two"));
    expect(calls.at(-1)).toEqual({
      url: "/api/admin/channels/admin-page-two",
      method: "PATCH",
      body: { status: "archived" }
    });
    await executeChannelOperation(adminChannelOperations.official({
      slug: "official-contract",
      name: "Official Contract",
      description: "created by exact contract test"
    }));
    expect(calls.at(-1)).toEqual({
      url: "/api/admin/channels",
      method: "POST",
      body: {
        kind: "official",
        slug: "official-contract",
        name: "Official Contract",
        description: "created by exact contract test",
        visibility: "public",
        discoverability: "discoverable",
        memberPostPolicy: "approval_required"
      }
    });
    await expect(executeChannelOperation(
      adminChannelOperations.takeover("admin-page-two", "replacement-owner")
    )).rejects.toThrow("takeover failed visibly");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("phase 7 admin channel UI exposes operations only to channel admins", async ({ page, request }, testInfo) => {
  await requirePhase7(request, testInfo);
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
  const creatorRequest = await playwrightRequest.newContext({ baseURL });
  const suffix = Date.now().toString(36);
  let channelId: string | null = null;
  let financeUserId: string | null = null;
  const reindexRequestedAfter = new Date();
  const preexistingReindexIds = new Set((await prisma.channelJob.findMany({
    where: { kind: "reindex_all" },
    select: { id: true }
  })).map(({ id }) => id));
  const createdReindexJobIds: string[] = [];
  const createdReindexAuditIds: string[] = [];
  const originalQuota = await prisma.channelQuotaOverride.findUnique({ where: { userId: "c1" } });

  try {
    await signInCreator(creatorRequest);
    const created = await creatorRequest.post("/api/dashboard/channels", {
      headers: authHeaders,
      data: {
        slug: `ui-review-${suffix}`,
        name: `UI Review ${suffix}`,
        description: "Task 9 protected admin review queue fixture.",
        visibility: "public",
        discoverability: "discoverable",
        memberPostPolicy: "approval_required"
      }
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    channelId = (await created.json()).channel.id;
    const submitted = await creatorRequest.post(`/api/dashboard/channels/${channelId}/submit`, {
      headers: authHeaders,
      data: {}
    });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();

    await signInAdmin(page.request);
    await page.goto("/admin");
    const operations = page.getByTestId("admin-channel-operations");
    await expect(operations).toBeVisible();
    await operations.getByLabel("频道状态筛选").selectOption("pending");
    const reviewRow = operations.getByRole("row").filter({ hasText: `UI Review ${suffix}` });
    await expect(reviewRow).toBeVisible();
    await reviewRow.getByRole("button", { name: "审核频道" }).click();
    const reviewDialog = page.getByRole("dialog", { name: "审核频道" });
    await expect(reviewDialog).toBeVisible();
    await reviewDialog.getByLabel("审核备注").fill("Task 9 live UI approval");
    await reviewDialog.getByRole("button", { name: "确认审核" }).click();
    await expect(reviewDialog).toHaveCount(0);

    page.on("dialog", (dialog) => void dialog.accept());
    await operations.getByLabel("频道状态筛选").selectOption("active");
    let activeRow = operations.getByRole("row").filter({ hasText: `UI Review ${suffix}` });
    await expect(activeRow).toBeVisible();
    await activeRow.getByLabel(`选择频道 UI Review ${suffix}`).check();
    await activeRow.getByRole("button", { name: "重新物化频道" }).click();
    await operations.getByRole("button", { name: "重新索引搜索" }).click();
    await expect(
      operations.getByRole("status").filter({ hasText: "重新索引作业已排程" })
    ).toBeVisible();
    const newReindexJobs = await prisma.channelJob.findMany({
      where: { kind: "reindex_all", createdAt: { gte: reindexRequestedAfter } },
      select: { id: true }
    });
    createdReindexJobIds.push(...newReindexJobs
      .map(({ id }) => id)
      .filter((id) => !preexistingReindexIds.has(id)));
    if (createdReindexJobIds.length) {
      const newAudits = await prisma.auditLog.findMany({
        where: {
          action: "search.reindex",
          targetType: "channel_job",
          targetId: { in: createdReindexJobIds }
        },
        select: { id: true }
      });
      createdReindexAuditIds.push(...newAudits.map(({ id }) => id));
    }
    await operations.getByLabel("频道配额", { exact: true }).fill("9");
    await operations.getByLabel("配额原因").fill("Task 9 live UI quota");
    await operations.getByRole("button", { name: "保存频道配额" }).click();
    await operations.getByLabel("接管新所有者 ID").fill("c2");
    await operations.getByRole("button", { name: "接管频道" }).click();
    await expect(operations.getByLabel("接管新所有者 ID")).toHaveValue("");

    activeRow = operations.getByRole("row").filter({ hasText: `UI Review ${suffix}` });
    await activeRow.getByRole("button", { name: `暂停 UI Review ${suffix}` }).click();
    await expect(
      operations.getByRole("status").filter({ hasText: "频道已暂停" })
    ).toBeVisible();
    await operations.getByLabel("频道状态筛选").selectOption("suspended");
    const suspendedRow = operations.getByRole("row").filter({ hasText: `UI Review ${suffix}` });
    await expect(suspendedRow).toBeVisible();
    await suspendedRow.getByRole("button", { name: `恢复 UI Review ${suffix}` }).click();
    await expect(
      operations.getByRole("status").filter({ hasText: "频道已恢复" })
    ).toBeVisible();
    await operations.getByLabel("频道状态筛选").selectOption("active");
    await expect(
      operations.getByRole("row").filter({ hasText: `UI Review ${suffix}` })
    ).toBeVisible();

    await expect(operations.getByRole("button", { name: "重新索引搜索" })).toBeVisible();
    await expect(operations.getByRole("button", { name: "重新物化频道" }).first()).toBeVisible();
    await expect(operations.getByLabel("频道配额", { exact: true })).toBeVisible();
    await expect(operations.getByLabel("接管新所有者 ID")).toBeVisible();

    await signInSupport(page.request);
    await page.goto("/admin");
    const readOnlyOperations = page.getByTestId("admin-channel-operations");
    await expect(readOnlyOperations).toBeVisible();
    await expect(readOnlyOperations).toContainText("当前管理员角色无频道变更权限");
    await expect(readOnlyOperations.getByRole("button", { name: "审核频道" })).toHaveCount(0);
    await expect(readOnlyOperations.getByRole("button", { name: "重新索引搜索" })).toHaveCount(0);

    const financeIdentity = await registerFan(page.request, "phase7-finance-admin");
    const financeUser = await prisma.user.findUniqueOrThrow({
      where: { email: financeIdentity.email },
      select: { id: true }
    });
    financeUserId = financeUser.id;
    await prisma.$transaction([
      prisma.user.update({ where: { id: financeUser.id }, data: { role: "admin" } }),
      prisma.adminAccount.create({
        data: { userId: financeUser.id, role: "finance_admin", status: "active" }
      })
    ]);
    await page.goto("/admin");
    const financeOperations = page.getByTestId("admin-channel-operations");
    await expect(financeOperations).toBeVisible();
    await expect(financeOperations).toContainText("当前管理员角色无频道变更权限");
    await expect(financeOperations.getByRole("button", { name: "审核频道" })).toHaveCount(0);
    await expect(financeOperations.getByRole("button", { name: "重新索引搜索" })).toHaveCount(0);

    expect(ADMIN_SECTIONS.finance_admin).not.toContain("channels");
    expect(ADMIN_SECTIONS.support_admin).not.toContain("channels");
    expect(ADMIN_SECTIONS.content_admin).toContain("channels");
    expect(ADMIN_SECTIONS.super_admin).toContain("channels");
  } finally {
    if (createdReindexAuditIds.length) {
      await prisma.auditLog.deleteMany({ where: { id: { in: createdReindexAuditIds } } });
    }
    if (createdReindexJobIds.length) {
      await prisma.channelJob.deleteMany({ where: { id: { in: createdReindexJobIds } } });
    }
    if (channelId) await cleanupPhase7MembershipArtifacts([], [], [channelId]);
    if (originalQuota) {
      await prisma.channelQuotaOverride.upsert({
        where: { userId: "c1" },
        create: {
          userId: originalQuota.userId,
          maxChannels: originalQuota.maxChannels,
          reason: originalQuota.reason,
          createdByAdminId: originalQuota.createdByAdminId
        },
        update: {
          maxChannels: originalQuota.maxChannels,
          reason: originalQuota.reason,
          createdByAdminId: originalQuota.createdByAdminId
        }
      });
    } else {
      await prisma.channelQuotaOverride.deleteMany({ where: { userId: "c1" } });
    }
    if (financeUserId) {
      await prisma.$transaction([
        prisma.adminAccount.deleteMany({ where: { userId: financeUserId } }),
        prisma.session.deleteMany({ where: { userId: financeUserId } }),
        prisma.account.deleteMany({ where: { userId: financeUserId } }),
        prisma.user.deleteMany({ where: { id: financeUserId } })
      ]);
    }
    await creatorRequest.dispose();
  }
});
