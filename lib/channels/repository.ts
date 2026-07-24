import { Prisma } from "@prisma/client";
import { CHANNEL_ADMIN_ROLES, isChannelAdminRole, type AdminContext } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getChannelAccess, resolveChannelAccess } from "./auth";
import {
  createChannelInvitationToken,
  encodeChannelMemberCursor,
  hashChannelInvitationToken,
  normalizeChannelMemberListInput,
  normalizeChannelInvitationEmail,
  resolveInvitationMutationTransition,
  resolveMembershipMutationVisibility,
  resolveMembershipReviewTransition,
  resolveMembershipUpdateTransition,
  type ChannelInvitationStatus,
  type ChannelMemberCursor,
  type MembershipReviewDecision,
  type MembershipUpdateInput
} from "./membership";
import {
  CHANNEL_KINDS,
  CHANNEL_QUOTAS,
  CHANNEL_STATUSES,
  CHANNEL_VISIBILITIES,
  type ChannelAccess,
  type ChannelCursor,
  type ChannelDetailResultDto,
  type ChannelDto,
  type ChannelJobInput,
  type ChannelLevelId,
  type ChannelLifecycleAction,
  type ChannelListItemDto,
  type ChannelMemberStatus,
  type ChannelPatchInput,
  type ChannelPostDto,
  type ChannelPostPolicy,
  type ChannelRole,
  type ChannelStatus,
  type ChannelVisibility,
  type CreateChannelInput,
  type ListChannelsInput,
  assertNoChannelIdentityOverrides,
  channelCursorMatchesScope,
  encodeChannelCursor,
  parseChannelCursor,
  projectChannelSafeSummary,
  resolveChannelIndexJob,
  resolveChannelLifecycleTransition,
  validateChannelPatchInput,
  validateQuotaOverrideInput,
  validateChannelInput
} from "./types";

const channelOwnerInclude = {
  owner: { select: { id: true, name: true, handle: true, avatar: true } }
} satisfies Prisma.ChannelInclude;

const channelMembershipSelect = {
  id: true,
  channelId: true,
  userId: true,
  role: true,
  status: true,
  invitedByUserId: true,
  reviewedByUserId: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ChannelMembershipSelect;

const channelInvitationSelect = {
  id: true,
  channelId: true,
  email: true,
  invitedUserId: true,
  expiresAt: true,
  status: true,
  invitedByUserId: true,
  acceptedByUserId: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ChannelInvitationSelect;

type ChannelWithOwner = Prisma.ChannelGetPayload<{ include: typeof channelOwnerInclude }>;
type DatabaseClient = Prisma.TransactionClient | typeof prisma;

export class ChannelRepositoryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "ChannelRepositoryError";
  }
}

export type ChannelMembershipDto = {
  id: string;
  channelId: string;
  userId: string;
  role: ChannelRole;
  status: ChannelMemberStatus;
  invitedByUserId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; name: string; handle: string; avatar: string };
};

export type ChannelInvitationDto = {
  id: string;
  channelId: string;
  email: string;
  invitedUserId: string | null;
  expiresAt: string;
  status: ChannelInvitationStatus;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

function denied(message: string): never {
  throw new ChannelRepositoryError(message, 403);
}

function conflict(message: string): never {
  throw new ChannelRepositoryError(message, 409);
}

function notFound(): never {
  throw new ChannelRepositoryError("Channel not found.", 404);
}

function isChannelLevelId(value: string | null): value is ChannelLevelId {
  return value !== null && Object.hasOwn(CHANNEL_QUOTAS, value);
}

function adminCanMutateChannels(admin: AdminContext) {
  return isChannelAdminRole(admin.role);
}

async function requireActiveAdmin(tx: Prisma.TransactionClient, admin: AdminContext) {
  if (!adminCanMutateChannels(admin)) denied("Admin role is not allowed for channel mutations.");
  const account = await tx.adminAccount.findFirst({
    where: {
      userId: admin.actorUserId,
      role: admin.role,
      status: "active",
      user: { status: "active" }
    },
    select: { id: true }
  });
  if (!account) denied("Active administrator access is required.");
}

async function creatorQuota(db: DatabaseClient, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      role: true,
      creatorStatus: true,
      creatorProfile: { select: { levelId: true } }
    }
  });
  if (
    !user
    || user.status !== "active"
    || user.role !== "creator"
    || user.creatorStatus !== "approved"
    || !user.creatorProfile
  ) {
    denied("Approved creator access is required.");
  }

  const levelId = isChannelLevelId(user.creatorProfile.levelId) ? user.creatorProfile.levelId : "level-1";
  const [override, used] = await Promise.all([
    db.channelQuotaOverride.findUnique({
      where: { userId },
      select: { maxChannels: true }
    }),
    db.channel.count({
      where: { ownerUserId: userId, kind: "creator", status: { not: "archived" } }
    })
  ]);

  return {
    used,
    limit: override?.maxChannels ?? CHANNEL_QUOTAS[levelId],
    levelId,
    overridden: Boolean(override)
  };
}

function mapChannel(channel: ChannelWithOwner, access: ChannelAccess): ChannelDto {
  return {
    id: channel.id,
    slug: channel.slug,
    name: channel.name,
    description: channel.description,
    avatarAssetId: channel.avatarAssetId,
    coverAssetId: channel.coverAssetId,
    kind: channel.kind as ChannelDto["kind"],
    visibility: channel.visibility as ChannelVisibility,
    discoverability: channel.discoverability as ChannelDto["discoverability"],
    status: channel.status as ChannelStatus,
    ownerUserId: channel.ownerUserId,
    createdByUserId: channel.createdByUserId,
    memberPostPolicy: channel.memberPostPolicy as ChannelPostPolicy,
    reviewNote: access.canManage ? channel.reviewNote : null,
    reviewedAt: channel.reviewedAt?.toISOString() ?? null,
    suspendedAt: channel.suspendedAt?.toISOString() ?? null,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    owner: channel.owner,
    access
  };
}

function mapMembership(membership: {
  id: string;
  channelId: string;
  userId: string;
  role: string;
  status: string;
  invitedByUserId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user?: { id: string; name: string; handle: string; avatar: string };
}): ChannelMembershipDto {
  return {
    ...membership,
    role: membership.role as ChannelRole,
    status: membership.status as ChannelMemberStatus,
    reviewedAt: membership.reviewedAt?.toISOString() ?? null,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString()
  };
}

function mapInvitation(invitation: {
  id: string;
  channelId: string;
  email: string;
  invitedUserId: string | null;
  expiresAt: Date;
  status: string;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ChannelInvitationDto {
  return {
    ...invitation,
    expiresAt: invitation.expiresAt.toISOString(),
    status: invitation.status as ChannelInvitationStatus,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString()
  };
}

function tagsFromJson(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

function normalizeLimit(value: number | undefined, maximum = 50) {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new ChannelRepositoryError(`Limit must be an integer between 1 and ${maximum}.`, 400);
  }
  return value;
}

function decodeRequiredCursor(
  value: string | undefined,
  scope: ChannelCursor["scope"],
  channelId?: string
): ChannelCursor | null {
  if (!value) return null;
  const cursor = parseChannelCursor(value);
  if (!cursor) throw new ChannelRepositoryError("Channel cursor is invalid.", 400);
  if (!channelCursorMatchesScope(cursor, scope, channelId)) {
    throw new ChannelRepositoryError("Channel cursor does not belong to this resource.", 400);
  }
  return cursor;
}

export function channelListAfterPredicate(cursor: ChannelCursor): Prisma.ChannelWhereInput {
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: cursor.id } }
    ]
  };
}

export function channelFeedAfterPredicate(cursor: ChannelCursor): Prisma.ChannelPostWhereInput {
  const publishedAt = new Date(cursor.createdAt);
  const publicationTail: Prisma.ChannelPostWhereInput = {
    OR: [
      { post: { createdAt: { lt: publishedAt } } },
      { post: { createdAt: publishedAt }, id: { lt: cursor.id } }
    ]
  };
  const positionTail: Prisma.ChannelPostWhereInput = cursor.position === null
    ? { position: null, AND: [publicationTail] }
    : {
        OR: [
          { position: { gt: cursor.position } },
          { position: null },
          { position: cursor.position, AND: [publicationTail] }
        ]
      };

  if (cursor.pinnedAt === null) {
    return { pinnedAt: null, AND: [positionTail] };
  }
  const pinnedAt = new Date(cursor.pinnedAt);
  return {
    OR: [
      { pinnedAt: { lt: pinnedAt } },
      { pinnedAt: null },
      { pinnedAt, AND: [positionTail] }
    ]
  };
}

export function channelMemberAfterPredicate(
  cursor: ChannelMemberCursor
): Prisma.ChannelMembershipWhereInput {
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { gt: createdAt } },
      { createdAt, id: { gt: cursor.id } }
    ]
  };
}

export function isChannelSelfReview(actorUserId: string, ownerUserId: string): boolean {
  return actorUserId === ownerUserId;
}

export function isSerializableConflict(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "P2034";
}

export async function retrySerializableOperation<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new TypeError("Serializable transaction attempts must be between 1 and 5.");
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableConflict(error)) throw error;
      if (attempt === maxAttempts) {
        conflict("Channel creation conflicted with another quota update. Please retry.");
      }
    }
  }
  throw new ChannelRepositoryError("Serializable transaction retry failed.", 409);
}

export async function retryMembershipSerializableOperation<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new TypeError("Serializable transaction attempts must be between 1 and 5.");
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableConflict(error)) throw error;
      if (attempt === maxAttempts) {
        conflict("Channel membership operation conflicted with another update. Please retry.");
      }
    }
  }
  throw new ChannelRepositoryError("Serializable membership retry failed.", 409);
}

export async function getCreatorChannelQuota(userId: string): Promise<{
  used: number;
  limit: number;
  levelId: string;
  overridden: boolean;
}> {
  return creatorQuota(prisma, userId);
}

export async function enqueueChannelJob(tx: Prisma.TransactionClient, input: ChannelJobInput): Promise<void> {
  await tx.channelJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      channelId: input.channelId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      availableAt: input.availableAt ?? new Date()
    }
  });
}

export async function createChannel(
  actorUserId: string,
  input: CreateChannelInput,
  admin?: AdminContext
): Promise<ChannelDto> {
  const validated = validateChannelInput(input);
  if (admin && admin.actorUserId !== actorUserId) denied("Administrator identity does not match the channel actor.");

  try {
    return await retrySerializableOperation(() => prisma.$transaction(async (tx) => {
      if (admin) {
        await requireActiveAdmin(tx, admin);
      } else {
        const quota = await creatorQuota(tx, actorUserId);
        if (quota.used >= quota.limit) conflict(`Creator channel quota reached (${quota.used}/${quota.limit}).`);
      }

      const kind = admin ? "official" : "creator";
      const status = admin ? "active" : "draft";
      const visibility = validated.visibility;
      const channel = await tx.channel.create({
        data: {
          slug: validated.slug,
          name: validated.name,
          description: validated.description,
          avatarAssetId: validated.avatarAssetId ?? null,
          coverAssetId: validated.coverAssetId ?? null,
          kind,
          visibility,
          discoverability: visibility === "public" ? "discoverable" : validated.discoverability,
          status,
          ownerUserId: actorUserId,
          createdByUserId: actorUserId,
          memberPostPolicy: validated.memberPostPolicy,
          reviewedByAdminId: admin?.actorUserId ?? null,
          reviewedAt: admin ? new Date() : null
        },
        include: channelOwnerInclude
      });

      await tx.channelMembership.create({
        data: {
          channelId: channel.id,
          userId: actorUserId,
          role: "owner",
          status: "active",
          reviewedByUserId: actorUserId,
          reviewedAt: new Date()
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          actorRole: admin?.role ?? "creator",
          action: "channel.create",
          targetType: "channel",
          targetId: channel.id,
          metadata: {
            kind,
            status,
            visibility: channel.visibility,
            discoverability: channel.discoverability
          }
        }
      });

      const version = channel.updatedAt.toISOString();
      await enqueueChannelJob(tx, resolveChannelIndexJob(channel.id, status, version));
      if (status === "active") {
        await enqueueChannelJob(tx, {
          idempotencyKey: `materialize:${channel.id}:${version}`,
          kind: "materialize_channel",
          channelId: channel.id
        });
      }

      return mapChannel(channel, resolveChannelAccess({
        status,
        visibility,
        role: admin ? null : "owner",
        adminRole: admin?.role ?? null
      }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof ChannelRepositoryError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      conflict("Channel slug is already in use.");
    }
    throw error;
  }
}

export async function submitChannel(actorUserId: string, channelId: string): Promise<ChannelDto> {
  return prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: { id: channelId },
      include: {
        ...channelOwnerInclude,
        memberships: {
          where: { userId: actorUserId, status: "active", role: "owner", user: { status: "active" } },
          select: { id: true }
        }
      }
    });
    if (!channel) notFound();
    if (channel.ownerUserId !== actorUserId || channel.memberships.length !== 1) {
      denied("Only the active channel owner may submit this channel.");
    }
    if (channel.kind !== "creator") conflict("Official channels do not use creator review.");
    if (channel.status !== "draft" && channel.status !== "rejected") {
      conflict("Only draft or rejected creator channels may be submitted.");
    }

    const updated = await tx.channel.update({
      where: { id: channelId },
      data: {
        status: "pending",
        reviewNote: null,
        reviewedByAdminId: null,
        reviewedAt: null
      },
      include: channelOwnerInclude
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: "creator",
        action: "channel.submit",
        targetType: "channel",
        targetId: channelId,
        metadata: { previousStatus: channel.status, status: "pending" }
      }
    });
    await enqueueChannelJob(tx, {
      idempotencyKey: `delete-index:channel:${channelId}:${updated.updatedAt.toISOString()}`,
      kind: "delete_index",
      channelId,
      entityType: "channel",
      entityId: channelId
    });
    return mapChannel(updated, resolveChannelAccess({
      status: "pending",
      visibility: updated.visibility as ChannelVisibility,
      role: "owner",
      adminRole: null
    }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewChannel(
  admin: AdminContext,
  channelId: string,
  decision: "approved" | "rejected",
  note: string
): Promise<ChannelDto> {
  const reviewNote = typeof note === "string" ? note.trim() : "";
  if (!reviewNote || reviewNote.length > 1000) {
    throw new ChannelRepositoryError("Review note must be 1-1000 characters.", 400);
  }
  if (decision !== "approved" && decision !== "rejected") {
    throw new ChannelRepositoryError("Review decision is invalid.", 400);
  }

  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, admin);
    const channel = await tx.channel.findUnique({
      where: { id: channelId },
      include: channelOwnerInclude
    });
    if (!channel) notFound();
    if (channel.kind !== "creator" || channel.status !== "pending") {
      conflict("Only pending creator channels may be reviewed.");
    }
    if (isChannelSelfReview(admin.actorUserId, channel.ownerUserId)) {
      denied("Channel owners cannot review their own creator channel.");
    }

    const status = decision === "approved" ? "active" : "rejected";
    const updated = await tx.channel.update({
      where: { id: channelId },
      data: {
        status,
        reviewNote,
        reviewedByAdminId: admin.actorUserId,
        reviewedAt: new Date(),
        suspendedAt: null
      },
      include: channelOwnerInclude
    });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.actorUserId,
        actorRole: admin.role,
        action: "channel.review",
        targetType: "channel",
        targetId: channelId,
        metadata: { decision, note: reviewNote, previousStatus: channel.status, status }
      }
    });

    const version = updated.updatedAt.toISOString();
    if (status === "active") {
      await enqueueChannelJob(tx, {
        idempotencyKey: `index:channel:${channelId}:${version}`,
        kind: "index_entity",
        channelId,
        entityType: "channel",
        entityId: channelId
      });
      await enqueueChannelJob(tx, {
        idempotencyKey: `materialize:${channelId}:${version}`,
        kind: "materialize_channel",
        channelId
      });
    } else {
      await enqueueChannelJob(tx, {
        idempotencyKey: `delete-index:channel:${channelId}:${version}`,
        kind: "delete_index",
        channelId,
        entityType: "channel",
        entityId: channelId
      });
    }

    return mapChannel(updated, {
      canRead: true,
      canManage: true,
      canCurate: true,
      canManageMembers: true,
      role: null
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

const adminChannelAccess: ChannelAccess = {
  canRead: true,
  canManage: true,
  canCurate: true,
  canManageMembers: true,
  role: null
};

async function enqueueLifecycleJob(
  tx: Prisma.TransactionClient,
  channel: { id: string; updatedAt: Date },
  kind: "index_entity" | "delete_index"
) {
  const version = channel.updatedAt.toISOString();
  const status = kind === "index_entity" ? "active" : "suspended";
  await enqueueChannelJob(tx, resolveChannelIndexJob(channel.id, status, version));
  if (kind === "index_entity") {
    await enqueueChannelJob(tx, {
      idempotencyKey: `materialize:${channel.id}:${version}`,
      kind: "materialize_channel",
      channelId: channel.id
    });
  }
}

function validateListInput(input: ListChannelsInput) {
  if (input.kind && !CHANNEL_KINDS.some((kind) => kind === input.kind)) {
    throw new ChannelRepositoryError("Channel kind is invalid.", 400);
  }
  if (input.visibility && !CHANNEL_VISIBILITIES.some((visibility) => visibility === input.visibility)) {
    throw new ChannelRepositoryError("Channel visibility is invalid.", 400);
  }
  if (input.status && !CHANNEL_STATUSES.some((status) => status === input.status)) {
    throw new ChannelRepositoryError("Channel status is invalid.", 400);
  }
}

export async function listCreatorChannels(
  actorUserId: string,
  input: ListChannelsInput = {}
): Promise<{ channels: ChannelDto[]; nextCursor: string | null }> {
  validateListInput(input);
  const limit = normalizeLimit(input.limit);
  const cursor = decodeRequiredCursor(input.cursor, "channel-list");
  const where: Prisma.ChannelWhereInput = {
    ownerUserId: actorUserId,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.status ? { status: input.status } : {}),
    NOT: { status: { in: ["suspended", "archived"] } }
  };
  const rows = await prisma.channel.findMany({
    where: cursor ? { AND: [where, channelListAfterPredicate(cursor)] } : where,
    include: channelOwnerInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const channels = rows.map((channel) => mapChannel(channel, resolveChannelAccess({
    status: channel.status as ChannelStatus,
    visibility: channel.visibility as ChannelVisibility,
    role: "owner",
    adminRole: null
  })));
  const last = rows.at(-1);
  return {
    channels,
    nextCursor: hasMore && last
      ? encodeChannelCursor({
          scope: "channel-list",
          channelId: null,
          pinnedAt: null,
          position: null,
          createdAt: last.createdAt.toISOString(),
          id: last.id
        })
      : null
  };
}

export async function getCreatorChannelById(actorUserId: string, channelId: string): Promise<ChannelDto> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      ...channelOwnerInclude,
      memberships: {
        where: { userId: actorUserId, role: "owner", status: "active", user: { status: "active" } },
        select: { id: true }
      }
    }
  });
  if (!channel) notFound();
  if (channel.ownerUserId !== actorUserId || channel.memberships.length !== 1) {
    denied("Only the active channel owner may access this dashboard channel.");
  }
  const access = resolveChannelAccess({
    status: channel.status as ChannelStatus,
    visibility: channel.visibility as ChannelVisibility,
    role: "owner",
    adminRole: null
  });
  if (!access.canRead) denied("Channel status does not permit owner access.");
  return mapChannel(channel, access);
}

export async function updateCreatorChannel(
  actorUserId: string,
  channelId: string,
  input: ChannelPatchInput
): Promise<ChannelDto> {
  const validated = validateChannelPatchInput(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const channel = await tx.channel.findUnique({
        where: { id: channelId },
        include: {
          ...channelOwnerInclude,
          memberships: {
            where: { userId: actorUserId, role: "owner", status: "active", user: { status: "active" } },
            select: { id: true }
          }
        }
      });
      if (!channel) notFound();
      if (channel.ownerUserId !== actorUserId || channel.memberships.length !== 1) {
        denied("Only the active channel owner may update this channel.");
      }
      if (!["draft", "rejected", "active"].includes(channel.status)) {
        conflict("Pending, suspended, and archived channels cannot be edited by their owner.");
      }

      const visibility = validated.visibility ?? channel.visibility;
      const updated = await tx.channel.update({
        where: { id: channelId },
        data: {
          slug: validated.slug,
          name: validated.name,
          description: validated.description,
          visibility: validated.visibility,
          discoverability: visibility === "public" ? "discoverable" : validated.discoverability,
          memberPostPolicy: validated.memberPostPolicy,
          avatarAssetId: validated.avatarAssetId,
          coverAssetId: validated.coverAssetId
        },
        include: channelOwnerInclude
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          actorRole: "creator",
          action: "channel.update",
          targetType: "channel",
          targetId: channelId,
          metadata: validated as Prisma.InputJsonValue
        }
      });
      await enqueueLifecycleJob(tx, updated, updated.status === "active" ? "index_entity" : "delete_index");
      return mapChannel(updated, resolveChannelAccess({
        status: updated.status as ChannelStatus,
        visibility: updated.visibility as ChannelVisibility,
        role: "owner",
        adminRole: null
      }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ChannelRepositoryError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      conflict("Channel slug is already in use.");
    }
    throw error;
  }
}

export async function getAdminChannelById(admin: AdminContext, channelId: string) {
  if (!adminCanMutateChannels(admin)) denied("Admin role is not allowed for channel access.");
  const account = await prisma.adminAccount.findFirst({
    where: {
      userId: admin.actorUserId,
      role: admin.role,
      status: "active",
      user: { status: "active" }
    },
    select: { id: true }
  });
  if (!account) denied("Active administrator access is required.");
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: channelOwnerInclude
  });
  if (!channel) notFound();
  const [memberships, auditLogs, jobs] = await Promise.all([
    prisma.channelMembership.findMany({
      where: { channelId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, handle: true, avatar: true } }
      }
    }),
    prisma.auditLog.findMany({
      where: { targetType: "channel", targetId: channelId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100
    }),
    prisma.channelJob.findMany({
      where: { channelId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        idempotencyKey: true,
        kind: true,
        status: true,
        attempts: true,
        availableAt: true,
        lockedAt: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true
      }
    })
  ]);
  return { channel: mapChannel(channel, adminChannelAccess), memberships, auditLogs, jobs };
}

export async function updateAdminChannel(
  admin: AdminContext,
  channelId: string,
  input: ChannelPatchInput
): Promise<ChannelDto> {
  const validated = validateChannelPatchInput(input, true);
  try {
    return await prisma.$transaction(async (tx) => {
      await requireActiveAdmin(tx, admin);
      const channel = await tx.channel.findUnique({
        where: { id: channelId },
        include: channelOwnerInclude
      });
      if (!channel) notFound();

      if (validated.status === "archived") {
        const transition = resolveChannelLifecycleTransition("archive", channel.status as ChannelStatus);
        if (!transition.changed && Object.keys(validated).length === 1) {
          return mapChannel(channel, adminChannelAccess);
        }
      }
      if (channel.status === "archived" && Object.keys(validated).some((field) => field !== "status")) {
        conflict("Archived channels cannot be edited.");
      }

      const visibility = validated.visibility ?? channel.visibility;
      const updated = await tx.channel.update({
        where: { id: channelId },
        data: {
          slug: validated.slug,
          name: validated.name,
          description: validated.description,
          visibility: validated.visibility,
          discoverability: visibility === "public" ? "discoverable" : validated.discoverability,
          memberPostPolicy: validated.memberPostPolicy,
          avatarAssetId: validated.avatarAssetId,
          coverAssetId: validated.coverAssetId,
          status: validated.status,
          suspendedAt: validated.status === "archived" ? null : undefined
        },
        include: channelOwnerInclude
      });
      await tx.auditLog.create({
        data: {
          actorUserId: admin.actorUserId,
          actorRole: admin.role,
          action: validated.status === "archived" ? "channel.archive" : "channel.update",
          targetType: "channel",
          targetId: channelId,
          metadata: {
            previousStatus: channel.status,
            ...validated
          } as Prisma.InputJsonValue
        }
      });
      await enqueueLifecycleJob(tx, updated, updated.status === "active" ? "index_entity" : "delete_index");
      return mapChannel(updated, adminChannelAccess);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ChannelRepositoryError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      conflict("Channel slug is already in use.");
    }
    throw error;
  }
}

export async function transitionChannel(
  admin: AdminContext,
  channelId: string,
  action: Exclude<ChannelLifecycleAction, "archive">
): Promise<ChannelDto> {
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, admin);
    const channel = await tx.channel.findUnique({
      where: { id: channelId },
      include: channelOwnerInclude
    });
    if (!channel) notFound();
    if (action === "restore" && isChannelSelfReview(admin.actorUserId, channel.ownerUserId)) {
      denied("Channel owners cannot restore their own channel.");
    }

    let transition: ReturnType<typeof resolveChannelLifecycleTransition>;
    try {
      transition = resolveChannelLifecycleTransition(action, channel.status as ChannelStatus);
    } catch (error) {
      if (error instanceof TypeError) conflict(error.message);
      throw error;
    }
    if (!transition.changed) return mapChannel(channel, adminChannelAccess);

    const updated = await tx.channel.update({
      where: { id: channelId },
      data: {
        status: transition.status,
        suspendedAt: action === "suspend" ? new Date() : null
      },
      include: channelOwnerInclude
    });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.actorUserId,
        actorRole: admin.role,
        action: `channel.${action}`,
        targetType: "channel",
        targetId: channelId,
        metadata: { previousStatus: channel.status, status: transition.status }
      }
    });
    if (transition.jobKind) await enqueueLifecycleJob(tx, updated, transition.jobKind);
    return mapChannel(updated, adminChannelAccess);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function takeoverChannel(
  admin: AdminContext,
  channelId: string,
  newOwnerUserId: string
): Promise<ChannelDto> {
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, admin);
    const channel = await tx.channel.findUnique({
      where: { id: channelId },
      include: channelOwnerInclude
    });
    if (!channel) notFound();
    const newOwner = await tx.user.findUnique({
      where: { id: newOwnerUserId },
      select: { id: true, status: true }
    });
    if (!newOwner || newOwner.status !== "active") {
      throw new ChannelRepositoryError("New channel owner was not found or is inactive.", 404);
    }

    const [existingOwnerRoleCount, existingTargetMembership] = await Promise.all([
      tx.channelMembership.count({
        where: { channelId, role: "owner" }
      }),
      tx.channelMembership.findUnique({
        where: { channelId_userId: { channelId, userId: newOwnerUserId } },
        select: { role: true, status: true }
      })
    ]);
    if (
      channel.ownerUserId === newOwnerUserId
      && existingOwnerRoleCount === 1
      && existingTargetMembership?.role === "owner"
      && existingTargetMembership.status === "active"
    ) {
      return mapChannel(channel, adminChannelAccess);
    }

    await tx.channelMembership.updateMany({
      where: { channelId, role: "owner", userId: { not: newOwnerUserId } },
      data: { role: "member" }
    });
    await tx.channelMembership.upsert({
      where: { channelId_userId: { channelId, userId: newOwnerUserId } },
      update: {
        role: "owner",
        status: "active",
        reviewedByUserId: admin.actorUserId,
        reviewedAt: new Date()
      },
      create: {
        channelId,
        userId: newOwnerUserId,
        role: "owner",
        status: "active",
        invitedByUserId: admin.actorUserId,
        reviewedByUserId: admin.actorUserId,
        reviewedAt: new Date()
      }
    });

    const changed = channel.ownerUserId !== newOwnerUserId;
    const updated = await tx.channel.update({
      where: { id: channelId },
      data: { ownerUserId: newOwnerUserId },
      include: channelOwnerInclude
    });
    const activeOwnerCount = await tx.channelMembership.count({
      where: { channelId, role: "owner", status: "active" }
    });
    if (activeOwnerCount !== 1) conflict("Channel takeover could not establish exactly one active owner.");

    await tx.auditLog.create({
      data: {
        actorUserId: admin.actorUserId,
        actorRole: admin.role,
        action: "channel.takeover",
        targetType: "channel",
        targetId: channelId,
        metadata: {
          previousOwnerUserId: channel.ownerUserId,
          newOwnerUserId,
          repairedOwnerMemberships: !changed
        }
      }
    });
    await enqueueLifecycleJob(tx, updated, updated.status === "active" ? "index_entity" : "delete_index");
    return mapChannel(updated, adminChannelAccess);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setChannelQuotaOverride(
  admin: AdminContext,
  userId: string,
  input: { maxChannels: number; reason: string }
) {
  const validated = validateQuotaOverrideInput(input);
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, admin);
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true, creatorStatus: true, status: true }
    });
    if (!target) throw new ChannelRepositoryError("Creator not found.", 404);
    if (target.status !== "active" || target.role !== "creator" || target.creatorStatus !== "approved") {
      throw new ChannelRepositoryError("Quota overrides require an active approved creator.", 409);
    }
    await creatorQuota(tx, userId);
    const quotaOverride = await tx.channelQuotaOverride.upsert({
      where: { userId },
      update: {
        maxChannels: validated.maxChannels,
        reason: validated.reason,
        createdByAdminId: admin.actorUserId
      },
      create: {
        userId,
        maxChannels: validated.maxChannels,
        reason: validated.reason,
        createdByAdminId: admin.actorUserId
      }
    });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.actorUserId,
        actorRole: admin.role,
        action: "channel.quota_override",
        targetType: "user",
        targetId: userId,
        metadata: validated
      }
    });
    const quota = await creatorQuota(tx, userId);
    return { quotaOverride, quota };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getAdminChannelQuota(admin: AdminContext, userId: string) {
  if (!adminCanMutateChannels(admin)) denied("Admin role is not allowed for channel access.");
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, creatorStatus: true, status: true }
  });
  if (!target) throw new ChannelRepositoryError("Creator not found.", 404);
  if (target.status !== "active" || target.role !== "creator" || target.creatorStatus !== "approved") {
    throw new ChannelRepositoryError("Quota overrides require an active approved creator.", 409);
  }
  return getCreatorChannelQuota(userId);
}

export function channelPublicListingWhere(viewerUserId: string | null): Prisma.ChannelWhereInput {
  void viewerUserId;
  return {
    status: "active",
    OR: [
      { visibility: "public" },
      { visibility: "private", discoverability: "discoverable" }
    ]
  };
}

async function getPublicChannelAccess(
  viewerUserId: string | null,
  channel: { id: string; status: string; visibility: string }
): Promise<ChannelAccess> {
  const membership = viewerUserId
    ? await prisma.channelMembership.findFirst({
        where: {
          channelId: channel.id,
          userId: viewerUserId,
          status: "active",
          user: { status: "active" }
        },
        select: { role: true }
      })
    : null;
  return resolveChannelAccess({
    status: channel.status as ChannelStatus,
    visibility: channel.visibility as ChannelVisibility,
    role: (membership?.role as ChannelRole | undefined) ?? null,
    adminRole: null
  });
}

export async function listChannels(
  input: ListChannelsInput,
  viewerUserId: string | null,
  options: { publicOnly?: boolean } = {}
): Promise<{ channels: ChannelListItemDto[]; nextCursor: string | null }> {
  validateListInput(input);
  const limit = normalizeLimit(input.limit);
  const cursor = decodeRequiredCursor(input.cursor, "channel-list");

  const activeAdmin = !options.publicOnly && viewerUserId
      ? await prisma.adminAccount.findFirst({
        where: {
          userId: viewerUserId,
          status: "active",
          role: { in: [...CHANNEL_ADMIN_ROLES] },
          user: { status: "active" }
        },
        orderBy: { createdAt: "asc" },
        select: { role: true }
      })
    : null;
  const hasAdminVisibility = Boolean(activeAdmin && isChannelAdminRole(activeAdmin.role));
  const where: Prisma.ChannelWhereInput = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.visibility ? { visibility: input.visibility } : {})
  };

  if (options.publicOnly) {
    Object.assign(where, channelPublicListingWhere(viewerUserId));
  } else if (hasAdminVisibility) {
    if (input.status) where.status = input.status;
  } else {
    where.status = "active";
    where.OR = [
      { visibility: "public" },
      { visibility: "private", discoverability: "discoverable" },
      ...(viewerUserId
        ? [{
            visibility: "private",
            memberships: { some: { userId: viewerUserId, status: "active", user: { status: "active" } } }
          } satisfies Prisma.ChannelWhereInput]
        : [])
    ];
  }

  const rows = await prisma.channel.findMany({
    where: cursor ? { AND: [where, channelListAfterPredicate(cursor)] } : where,
    include: channelOwnerInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const channels = await Promise.all(rows.map(async (channel) => {
    const access = options.publicOnly
      ? await getPublicChannelAccess(viewerUserId, channel)
      : await getChannelAccess(viewerUserId, channel.id);
    return !access.canRead
      ? projectChannelSafeSummary(channel)
      : mapChannel(channel, access);
  }));
  const last = rows.at(-1);
  return {
    channels,
    nextCursor: hasMore && last
      ? encodeChannelCursor({
          scope: "channel-list",
          channelId: null,
          pinnedAt: null,
          position: null,
          createdAt: last.createdAt.toISOString(),
          id: last.id
        })
      : null
  };
}

export async function getChannelBySlug(
  slug: string,
  viewerUserId: string | null,
  cursorValue?: string,
  options: { publicOnly?: boolean } = {}
): Promise<ChannelDetailResultDto> {
  const channel = await prisma.channel.findUnique({
    where: { slug },
    include: channelOwnerInclude
  });
  if (!channel) notFound();

  const access = options.publicOnly
    ? await getPublicChannelAccess(viewerUserId, channel)
    : await getChannelAccess(viewerUserId, channel.id);
  const maySeeSafeSummary = channel.status === "active"
    && channel.visibility === "private"
    && channel.discoverability === "discoverable";
  if (!access.canRead && !maySeeSafeSummary) notFound();

  if (!access.canRead) {
    return projectChannelSafeSummary(channel);
  }
  const cursor = decodeRequiredCursor(cursorValue, "channel-feed", channel.id);

  const excluded = await prisma.channelPostExclusion.findMany({
    where: { channelId: channel.id },
    select: { postId: true }
  });
  const postRows = await prisma.channelPost.findMany({
    where: {
      AND: [
        {
          channelId: channel.id,
          status: "active",
          ...(excluded.length ? { postId: { notIn: excluded.map((item) => item.postId) } } : {})
        },
        ...(cursor ? [channelFeedAfterPredicate(cursor)] : [])
      ]
    },
    include: {
      post: {
        select: {
          id: true,
          creatorId: true,
          title: true,
          excerpt: true,
          cover: true,
          category: true,
          tags: true,
          visibility: true,
          price: true,
          createdAt: true
        }
      }
    },
    orderBy: [
      { pinnedAt: { sort: "desc", nulls: "last" } },
      { position: { sort: "asc", nulls: "last" } },
      { post: { createdAt: "desc" } },
      { id: "desc" }
    ],
    take: 21
  });
  const hasMore = postRows.length > 20;
  if (hasMore) postRows.pop();
  const posts: ChannelPostDto[] = postRows.map((item) => ({
    id: item.id,
    postId: item.postId,
    source: item.source as ChannelPostDto["source"],
    position: item.position,
    pinnedAt: item.pinnedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    post: {
      ...item.post,
      tags: tagsFromJson(item.post.tags),
      createdAt: item.post.createdAt.toISOString()
    }
  }));
  const last = postRows.at(-1);
  return {
    ...mapChannel(channel, access),
    posts,
    nextCursor: hasMore && last
      ? encodeChannelCursor({
          scope: "channel-feed",
          channelId: channel.id,
          pinnedAt: last.pinnedAt?.toISOString() ?? null,
          position: last.position,
          createdAt: last.post.createdAt.toISOString(),
          id: last.id
        })
      : null
  };
}

async function requireMembershipManager(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  channelId: string,
  allowEditor: boolean
) {
  const channel = await tx.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      status: true,
      visibility: true,
      ownerUserId: true,
      memberships: {
        where: {
          userId: actorUserId,
          status: "active",
          role: { in: allowEditor ? ["owner", "editor"] : ["owner"] },
          user: { status: "active" }
        },
        select: { role: true },
        take: 1
      }
    }
  });
  if (!channel) notFound();
  if (channel.status !== "active") {
    conflict("Membership management requires an active channel.");
  }
  const role = channel.memberships[0]?.role;
  if (!role || (!allowEditor && (role !== "owner" || channel.ownerUserId !== actorUserId))) {
    denied(allowEditor
      ? "Only an active channel owner or editor may view members."
      : "Only the active channel owner may manage members.");
  }
  return { ...channel, actorRole: role as "owner" | "editor" };
}

export async function requestChannelMembership(
  actorUserId: string,
  slug: string
): Promise<ChannelMembershipDto> {
  return retryMembershipSerializableOperation(() => prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: { slug },
      select: {
        id: true,
        status: true,
        visibility: true,
        discoverability: true,
        memberships: {
          where: { userId: actorUserId, status: "active", user: { status: "active" } },
          select: { id: true },
          take: 1
        }
      }
    });
    resolveMembershipMutationVisibility("join", {
      exists: Boolean(channel),
      status: channel?.status ?? null,
      visibility: channel?.visibility ?? null,
      discoverability: channel?.discoverability ?? null,
      hasActiveMembership: Boolean(channel?.memberships.length),
      hasRemovedMembership: false
    });
    if (!channel) notFound();
    if (channel.status !== "active") conflict("This channel is not accepting join requests.");
    if (channel.visibility !== "private") conflict("Public channels do not require membership requests.");

    const existing = await tx.channelMembership.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: actorUserId } },
      select: channelMembershipSelect
    });
    if (existing?.status === "pending") return mapMembership(existing);
    if (existing?.status === "active") {
      conflict("The authenticated user is already an active channel member.");
    }
    if (existing?.status === "invited") {
      conflict("The authenticated user already has a pending invitation.");
    }

    const membership = await tx.channelMembership.upsert({
      where: { channelId_userId: { channelId: channel.id, userId: actorUserId } },
      update: {
        role: "member",
        status: "pending",
        invitedByUserId: null,
        reviewedByUserId: null,
        reviewedAt: null
      },
      create: {
        channelId: channel.id,
        userId: actorUserId,
        role: "member",
        status: "pending"
      },
      select: channelMembershipSelect
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: "user",
        action: "channel.membership_request",
        targetType: "channel_membership",
        targetId: membership.id,
        metadata: { previousStatus: existing?.status ?? null, status: "pending", channelId: channel.id }
      }
    });
    return mapMembership(membership);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function listChannelMembers(
  actorUserId: string,
  channelId: string,
  input: { cursor?: string; limit?: number } = {}
): Promise<{ memberships: ChannelMembershipDto[]; nextCursor: string | null }> {
  const { cursor, limit } = normalizeChannelMemberListInput(input, channelId);
  return prisma.$transaction(async (tx) => {
    await requireMembershipManager(tx, actorUserId, channelId, true);
    const rows = await tx.channelMembership.findMany({
      where: cursor
        ? { AND: [{ channelId }, channelMemberAfterPredicate(cursor)] }
        : { channelId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        ...channelMembershipSelect,
        user: { select: { id: true, name: true, handle: true, avatar: true } }
      }
    });
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      memberships: rows.map(mapMembership),
      nextCursor: hasMore && last
        ? encodeChannelMemberCursor({
            scope: "channel-members",
            channelId,
            createdAt: last.createdAt.toISOString(),
            id: last.id
          })
        : null
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewChannelMembership(
  actorUserId: string,
  channelId: string,
  membershipId: string,
  decision: MembershipReviewDecision
): Promise<ChannelMembershipDto> {
  return retryMembershipSerializableOperation(() => prisma.$transaction(async (tx) => {
    await requireMembershipManager(tx, actorUserId, channelId, false);
    const membership = await tx.channelMembership.findFirst({
      where: { id: membershipId, channelId },
      select: channelMembershipSelect
    });
    if (!membership) throw new ChannelRepositoryError("Channel membership not found.", 404);
    const transition = resolveMembershipReviewTransition(
      membership.status as ChannelMemberStatus,
      decision
    );
    if (!transition.changed) return mapMembership(membership);

    const updated = await tx.channelMembership.update({
      where: { id: membership.id },
      data: {
        role: "member",
        status: transition.status,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date()
      },
      select: channelMembershipSelect
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: "owner",
        action: "channel.membership_review",
        targetType: "channel_membership",
        targetId: membership.id,
        metadata: {
          channelId,
          decision,
          previousStatus: membership.status,
          status: transition.status
        }
      }
    });
    return mapMembership(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function updateChannelMembership(
  actorUserId: string,
  channelId: string,
  membershipId: string,
  input: MembershipUpdateInput
): Promise<ChannelMembershipDto> {
  return retryMembershipSerializableOperation(() => prisma.$transaction(async (tx) => {
    const channel = await requireMembershipManager(tx, actorUserId, channelId, false);
    const membership = await tx.channelMembership.findFirst({
      where: { id: membershipId, channelId },
      select: channelMembershipSelect
    });
    if (!membership) throw new ChannelRepositoryError("Channel membership not found.", 404);
    if (membership.userId === channel.ownerUserId || membership.role === "owner") {
      conflict("The channel owner membership cannot be changed here.");
    }
    const transition = resolveMembershipUpdateTransition({
      role: membership.role as ChannelRole,
      status: membership.status as ChannelMemberStatus
    }, input);
    if (!transition.changed) return mapMembership(membership);

    const updated = await tx.channelMembership.update({
      where: { id: membership.id },
      data: {
        role: transition.role,
        status: transition.status,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date()
      },
      select: channelMembershipSelect
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: "owner",
        action: "channel.membership_update",
        targetType: "channel_membership",
        targetId: membership.id,
        metadata: {
          channelId,
          previousRole: membership.role,
          role: transition.role,
          previousStatus: membership.status,
          status: transition.status
        }
      }
    });
    return mapMembership(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function leaveChannelMembership(
  actorUserId: string,
  slug: string
): Promise<{ membership: ChannelMembershipDto | null; changed: boolean }> {
  return retryMembershipSerializableOperation(() => prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: { slug },
      select: {
        id: true,
        ownerUserId: true,
        status: true,
        visibility: true,
        discoverability: true,
        memberships: {
          where: { userId: actorUserId, user: { status: "active" } },
          select: { id: true, status: true },
          take: 1
        }
      }
    });
    resolveMembershipMutationVisibility("leave", {
      exists: Boolean(channel),
      status: channel?.status ?? null,
      visibility: channel?.visibility ?? null,
      discoverability: channel?.discoverability ?? null,
      hasActiveMembership: channel?.memberships[0]?.status === "active",
      hasRemovedMembership: channel?.memberships[0]?.status === "removed"
    });
    if (!channel) notFound();
    const membership = await tx.channelMembership.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: actorUserId } },
      select: channelMembershipSelect
    });
    if (!membership) return { membership: null, changed: false };
    if (membership.userId === channel.ownerUserId || membership.role === "owner") {
      conflict("The channel owner cannot leave without transferring ownership.");
    }
    if (membership.status === "removed") {
      return { membership: mapMembership(membership), changed: false };
    }
    const updated = await tx.channelMembership.update({
      where: { id: membership.id },
      data: {
        status: "removed",
        reviewedByUserId: actorUserId,
        reviewedAt: new Date()
      },
      select: channelMembershipSelect
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: "member",
        action: "channel.membership_leave",
        targetType: "channel_membership",
        targetId: membership.id,
        metadata: { channelId: channel.id, previousStatus: membership.status, status: "removed" }
      }
    });
    return { membership: mapMembership(updated), changed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function createChannelInvitation(
  actorUserId: string,
  channelId: string,
  emailValue: string
): Promise<{ invitation: ChannelInvitationDto; token: string }> {
  const email = normalizeChannelInvitationEmail(emailValue);
  return retryMembershipSerializableOperation(async () => {
    const { token, tokenHash } = createChannelInvitationToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitation = await prisma.$transaction(async (tx) => {
    await requireMembershipManager(tx, actorUserId, channelId, false);
    const channel = await tx.channel.findUnique({
      where: { id: channelId },
      select: { visibility: true }
    });
    if (!channel) notFound();
    if (channel.visibility !== "private") conflict("Invitations are only available for private channels.");

    const invitedUser = await tx.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, status: "active" },
      select: { id: true }
    });
    const existingMembership = invitedUser
      ? await tx.channelMembership.findUnique({
          where: { channelId_userId: { channelId, userId: invitedUser.id } },
          select: channelMembershipSelect
        })
      : null;
    if (existingMembership?.status === "active") {
      conflict("The invited user is already an active channel member.");
    }
    if (existingMembership?.role === "owner") {
      conflict("The channel owner cannot be invited.");
    }

    const invitationsToRevoke = await tx.channelInvitation.findMany({
      where: { channelId, email, status: "pending" },
      select: { id: true }
    });
    if (invitationsToRevoke.length) {
      const revoked = await tx.channelInvitation.updateMany({
        where: {
          id: { in: invitationsToRevoke.map(({ id }) => id) },
          status: "pending"
        },
        data: { status: "revoked" }
      });
      if (revoked.count !== invitationsToRevoke.length) throw { code: "P2034" };
    }
    const created = await tx.channelInvitation.create({
      data: {
        channelId,
        email,
        invitedUserId: invitedUser?.id ?? null,
        tokenHash,
        expiresAt,
        status: "pending",
        invitedByUserId: actorUserId
      },
      select: channelInvitationSelect
    });
    if (
      invitedUser
      && existingMembership?.status !== "pending"
      && existingMembership?.status !== "invited"
    ) {
      const invitedMembership = await tx.channelMembership.upsert({
        where: { channelId_userId: { channelId, userId: invitedUser.id } },
        update: {
          role: "member",
          status: "invited",
          invitedByUserId: actorUserId,
          reviewedByUserId: null,
          reviewedAt: null
        },
        create: {
          channelId,
          userId: invitedUser.id,
          role: "member",
          status: "invited",
          invitedByUserId: actorUserId
        },
        select: channelMembershipSelect
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          actorRole: "owner",
          action: "channel.membership_invite",
          targetType: "channel_membership",
          targetId: invitedMembership.id,
          metadata: {
            channelId,
            invitationId: created.id,
            previousStatus: existingMembership?.status ?? null,
            status: "invited"
          }
        }
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: "owner",
        action: "channel.invitation_create",
        targetType: "channel_invitation",
        targetId: created.id,
        metadata: { channelId, status: "pending", expiresAt: expiresAt.toISOString() }
      }
    });
    if (invitationsToRevoke.length) {
      await tx.auditLog.createMany({
        data: invitationsToRevoke.map(({ id }) => ({
          actorUserId,
          actorRole: "owner",
          action: "channel.invitation_revoke",
          targetType: "channel_invitation",
          targetId: id,
          metadata: { channelId, status: "revoked" }
        }))
      });
    }
    return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { invitation: mapInvitation(invitation), token };
  });
}

async function persistExpiredInvitation(
  tx: Prisma.TransactionClient,
  invitation: { id: string; channelId: string },
  actorUserId: string
) {
  const expired = await tx.channelInvitation.updateMany({
    where: { id: invitation.id, status: "pending" },
    data: { status: "expired" }
  });
  if (expired.count !== 1) throw { code: "P2034" };
  await tx.auditLog.create({
    data: {
      actorUserId,
      actorRole: "member",
      action: "channel.invitation_expire",
      targetType: "channel_invitation",
      targetId: invitation.id,
      metadata: { channelId: invitation.channelId, status: "expired" }
    }
  });
}

export async function acceptChannelInvitation(
  actor: { id: string; email: string },
  token: string
): Promise<{ invitation: ChannelInvitationDto; membership: ChannelMembershipDto }> {
  const tokenHash = hashChannelInvitationToken(token);
  const result = await retryMembershipSerializableOperation(() => prisma.$transaction(async (tx) => {
    const invitation = await tx.channelInvitation.findUnique({
      where: { tokenHash },
      select: {
        ...channelInvitationSelect,
        channel: { select: { status: true, visibility: true } }
      }
    });
    if (!invitation) throw new ChannelRepositoryError("Invitation not found.", 404);
    if (normalizeChannelInvitationEmail(actor.email) !== normalizeChannelInvitationEmail(invitation.email)) {
      denied("Invitation email does not match the authenticated user.");
    }

    const user = await tx.user.findUnique({
      where: { id: actor.id },
      select: { id: true, email: true, status: true }
    });
    if (
      !user
      || user.status !== "active"
      || normalizeChannelInvitationEmail(user.email) !== normalizeChannelInvitationEmail(invitation.email)
    ) {
      denied("Invitation email does not match the authenticated user.");
    }
    const transition = resolveInvitationMutationTransition({
      status: invitation.status as ChannelInvitationStatus,
      expiresAt: invitation.expiresAt
    }, "accept");
    if (transition.status === "expired" && transition.changed) {
      await persistExpiredInvitation(tx, invitation, actor.id);
      return {
        ok: false,
        error: transition.conflict ?? "Invitation is expired."
      } as const;
    }
    if (transition.conflict) conflict(transition.conflict);
    if (invitation.channel.status !== "active" || invitation.channel.visibility !== "private") {
      conflict("Invitation channel is not active and private.");
    }

    const existing = await tx.channelMembership.findUnique({
      where: { channelId_userId: { channelId: invitation.channelId, userId: actor.id } },
      select: channelMembershipSelect
    });
    if (existing?.role === "owner") conflict("The channel owner cannot accept a member invitation.");
    const claimed = await tx.channelInvitation.updateMany({
      where: { id: invitation.id, status: "pending" },
      data: { status: "accepted", acceptedByUserId: actor.id }
    });
    if (claimed.count !== 1) throw { code: "P2034" };
    const role = existing?.status === "active" && existing.role === "editor" ? "editor" : "member";
    const membership = await tx.channelMembership.upsert({
      where: { channelId_userId: { channelId: invitation.channelId, userId: actor.id } },
      update: {
        role,
        status: "active",
        invitedByUserId: invitation.invitedByUserId,
        reviewedByUserId: invitation.invitedByUserId,
        reviewedAt: new Date()
      },
      create: {
        channelId: invitation.channelId,
        userId: actor.id,
        role: "member",
        status: "active",
        invitedByUserId: invitation.invitedByUserId,
        reviewedByUserId: invitation.invitedByUserId,
        reviewedAt: new Date()
      },
      select: channelMembershipSelect
    });
    const accepted = await tx.channelInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
      select: channelInvitationSelect
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: "member",
        action: "channel.invitation_accept",
        targetType: "channel_membership",
        targetId: membership.id,
        metadata: {
          channelId: invitation.channelId,
          invitationId: invitation.id,
          previousStatus: existing?.status ?? null,
          status: "active"
        }
      }
    });
    return { ok: true, invitation: accepted, membership } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  if (!result.ok) {
    throw new ChannelRepositoryError(result.error, 409);
  }
  return {
    invitation: mapInvitation(result.invitation),
    membership: mapMembership(result.membership)
  };
}

export async function rejectChannelInvitation(
  actor: { id: string; email: string },
  token: string
): Promise<{ invitation: ChannelInvitationDto }> {
  const tokenHash = hashChannelInvitationToken(token);
  const result = await retryMembershipSerializableOperation(() => prisma.$transaction(async (tx) => {
    const current = await tx.channelInvitation.findUnique({
      where: { tokenHash },
      select: channelInvitationSelect
    });
    if (!current) throw new ChannelRepositoryError("Invitation not found.", 404);
    if (normalizeChannelInvitationEmail(actor.email) !== normalizeChannelInvitationEmail(current.email)) {
      denied("Invitation email does not match the authenticated user.");
    }
    const user = await tx.user.findUnique({
      where: { id: actor.id },
      select: { email: true, status: true }
    });
    if (
      !user
      || user.status !== "active"
      || normalizeChannelInvitationEmail(user.email) !== normalizeChannelInvitationEmail(current.email)
    ) {
      denied("Invitation email does not match the authenticated user.");
    }
    const transition = resolveInvitationMutationTransition({
      status: current.status as ChannelInvitationStatus,
      expiresAt: current.expiresAt
    }, "reject");
    if (transition.status === "expired" && transition.changed) {
      await persistExpiredInvitation(tx, current, actor.id);
      return {
        ok: false,
        error: transition.conflict ?? "Invitation is expired."
      } as const;
    }
    if (transition.conflict) conflict(transition.conflict);
    if (!transition.changed && transition.status === "rejected") {
      return { ok: true, invitation: current } as const;
    }

    const claimed = await tx.channelInvitation.updateMany({
      where: { id: current.id, status: "pending" },
      data: { status: "rejected" },
    });
    if (claimed.count !== 1) throw { code: "P2034" };
    if (current.invitedUserId === actor.id) {
      const membership = await tx.channelMembership.findUnique({
        where: {
          channelId_userId: {
            channelId: current.channelId,
            userId: actor.id
          }
        },
        select: channelMembershipSelect
      });
      if (membership?.status === "invited" && membership.role === "member") {
        await tx.channelMembership.update({
          where: { id: membership.id },
          data: {
            status: "rejected",
            reviewedByUserId: actor.id,
            reviewedAt: new Date()
          }
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: "member",
            action: "channel.membership_reject_invitation",
            targetType: "channel_membership",
            targetId: membership.id,
            metadata: {
              channelId: current.channelId,
              invitationId: current.id,
              previousStatus: "invited",
              status: "rejected"
            }
          }
        });
      }
    }
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: "member",
        action: "channel.invitation_reject",
        targetType: "channel_invitation",
        targetId: current.id,
        metadata: { channelId: current.channelId, status: "rejected" }
      }
    });
    const rejected = await tx.channelInvitation.findUniqueOrThrow({
      where: { id: current.id },
      select: channelInvitationSelect
    });
    return { ok: true, invitation: rejected } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  if (!result.ok) {
    throw new ChannelRepositoryError(result.error, 409);
  }
  return { invitation: mapInvitation(result.invitation) };
}

const MIN_CHANNEL_POSITION = -2_147_483_648;
const MAX_CHANNEL_POSITION = 2_147_483_647;
type CurationCursorScope = "channel-rules" | "channel-exclusions";
type CurationCursor = {
  scope: CurationCursorScope;
  channelId: string;
  createdAt: string;
  id: string;
};

export type ChannelPostMutationInput = {
  postId: string;
  position?: number | null;
  pinned?: boolean;
};

export type ChannelPostPatchInput = {
  position?: number | null;
  pinned?: boolean;
  status?: "active" | "rejected" | "removed";
};

export type ChannelRuleMutationInput = {
  kind: "category" | "tag" | "creator";
  value: string;
  enabled: boolean;
};

export type ChannelExclusionMutationInput = {
  postId: string;
  reason: string;
};

function requiredIdentifier(value: unknown, field: string): string {
  const identifier = typeof value === "string" ? value.trim() : "";
  if (!identifier || identifier.length > 191) throw new TypeError(`${field} must be a non-empty identifier.`);
  return identifier;
}

function optionalPosition(value: unknown, field = "position"): number | null {
  if (value === null) return null;
  if (
    !Number.isInteger(value)
    || (value as number) < MIN_CHANNEL_POSITION
    || (value as number) > MAX_CHANNEL_POSITION
  ) {
    throw new TypeError(`${field} must be a signed 32-bit integer or null.`);
  }
  return value as number;
}

function curationRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownCurationFields(input: Record<string, unknown>, allowed: readonly string[]) {
  assertNoChannelIdentityOverrides(input);
  const fields = new Set(allowed);
  const unknown = Object.keys(input).find((field) => !fields.has(field));
  if (unknown) throw new TypeError(`${unknown} is not allowed in this channel curation mutation.`);
}

export function validateChannelPostMutationInput(input: unknown): ChannelPostMutationInput {
  const record = curationRecord(input, "Channel post input");
  rejectUnknownCurationFields(record, ["postId", "position", "pinned"]);
  const result: ChannelPostMutationInput = { postId: requiredIdentifier(record.postId, "postId") };
  if (Object.hasOwn(record, "position")) result.position = optionalPosition(record.position);
  if (Object.hasOwn(record, "pinned")) {
    if (typeof record.pinned !== "boolean") throw new TypeError("pinned must be a boolean.");
    result.pinned = record.pinned;
  }
  return result;
}

export function validateChannelPostPatchInput(input: unknown): ChannelPostPatchInput {
  const record = curationRecord(input, "Channel post update");
  rejectUnknownCurationFields(record, ["position", "pinned", "status"]);
  if (Object.keys(record).length === 0) throw new TypeError("Channel post update must include a field.");
  const result: ChannelPostPatchInput = {};
  if (Object.hasOwn(record, "position")) result.position = optionalPosition(record.position);
  if (Object.hasOwn(record, "pinned")) {
    if (typeof record.pinned !== "boolean") throw new TypeError("pinned must be a boolean.");
    result.pinned = record.pinned;
  }
  if (Object.hasOwn(record, "status")) {
    if (!["active", "rejected", "removed"].includes(String(record.status))) {
      throw new TypeError("Channel post status is invalid.");
    }
    result.status = record.status as ChannelPostPatchInput["status"];
  }
  return result;
}

export function validateChannelRuleMutationInput(
  input: unknown,
  partial = false
): Partial<ChannelRuleMutationInput> {
  const record = curationRecord(input, "Channel rule input");
  rejectUnknownCurationFields(record, ["kind", "value", "enabled"]);
  if (partial && Object.keys(record).length === 0) throw new TypeError("Channel rule update must include a field.");
  const result: Partial<ChannelRuleMutationInput> = {};
  if (!partial || Object.hasOwn(record, "kind")) {
    if (!["category", "tag", "creator"].includes(String(record.kind))) {
      throw new TypeError("Channel rule kind is invalid.");
    }
    result.kind = record.kind as ChannelRuleMutationInput["kind"];
  }
  if (!partial || Object.hasOwn(record, "value")) {
    const value = typeof record.value === "string" ? record.value.trim() : "";
    if (!value || value.length > 191) throw new TypeError("Channel rule value must be 1-191 characters.");
    result.value = value;
  }
  if (Object.hasOwn(record, "enabled")) {
    if (typeof record.enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
    result.enabled = record.enabled;
  } else if (!partial) {
    result.enabled = true;
  }
  return result;
}

export function validateChannelExclusionMutationInput(input: unknown): ChannelExclusionMutationInput {
  const record = curationRecord(input, "Channel exclusion input");
  rejectUnknownCurationFields(record, ["postId", "reason"]);
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!reason || reason.length > 500) throw new TypeError("reason must be 1-500 characters.");
  return { postId: requiredIdentifier(record.postId, "postId"), reason };
}

function parseCurationCursor(
  value: string | undefined,
  scope: CurationCursorScope,
  channelId: string
): CurationCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CurationCursor>;
    if (
      parsed.scope !== scope
      || parsed.channelId !== channelId
      || typeof parsed.createdAt !== "string"
      || new Date(parsed.createdAt).toISOString() !== parsed.createdAt
      || typeof parsed.id !== "string"
      || !parsed.id
    ) {
      throw new Error("invalid");
    }
    return parsed as CurationCursor;
  } catch {
    throw new ChannelRepositoryError("Channel curation cursor is invalid.", 400);
  }
}

function encodeCurationCursor(cursor: CurationCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

async function requireCurationAccess(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  channelId: string,
  options: { allowMember: boolean; mutation: boolean }
) {
  const channel = await tx.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      status: true,
      memberPostPolicy: true,
      memberships: {
        where: { userId: actorUserId, status: "active", user: { status: "active" } },
        select: { role: true },
        take: 1
      }
    }
  });
  if (!channel) notFound();
  const membershipRole = channel.memberships[0]?.role as ChannelRole | undefined;
  const admin = await tx.adminAccount.findFirst({
    where: {
      userId: actorUserId,
      status: "active",
      role: { in: [...CHANNEL_ADMIN_ROLES] },
      user: { status: "active" }
    },
    select: { role: true }
  });
  const curator = Boolean(admin && isChannelAdminRole(admin.role))
    || membershipRole === "owner"
    || membershipRole === "editor";
  if (!curator && !(options.allowMember && membershipRole === "member")) {
    notFound();
  }
  if (options.mutation && channel.status !== "active") {
    conflict("Channel curation requires an active channel.");
  }
  return {
    channel,
    role: curator ? (membershipRole ?? "admin") : "member",
    curator
  };
}

function isCurationSerializationConflict(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ["P2002", "P2034"].includes(String((error as { code?: unknown }).code));
}

async function retryCurationSerializableOperation<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isCurationSerializationConflict(error)) throw error;
      if (attempt === 3) conflict("Channel curation conflicted with another update. Please retry.");
    }
  }
  conflict("Channel curation conflicted with another update. Please retry.");
}

async function normalizeChannelPostPositions(
  tx: Prisma.TransactionClient,
  channelId: string,
  targetId: string,
  desiredPosition: number | null
) {
  const rows = await tx.channelPost.findMany({
    where: {
      channelId,
      status: "active",
      OR: [{ position: { not: null } }, { id: targetId }]
    },
    orderBy: [
      { position: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" }
    ],
    select: { id: true }
  });
  const ordered = rows.filter(({ id }) => id !== targetId);
  if (desiredPosition !== null && rows.some(({ id }) => id === targetId)) {
    const insertionIndex = Math.max(0, Math.min(desiredPosition, ordered.length));
    ordered.splice(insertionIndex, 0, { id: targetId });
  }
  for (let position = 0; position < ordered.length; position += 1) {
    await tx.channelPost.update({
      where: { id: ordered[position].id },
      data: { position }
    });
  }
  if (desiredPosition === null) {
    await tx.channelPost.update({ where: { id: targetId }, data: { position: null } });
  }
}

function mapChannelPostMutation(row: {
  id: string;
  channelId: string;
  postId: string;
  source: string;
  status: string;
  position: number | null;
  pinnedAt: Date | null;
  addedByUserId: string;
  reviewedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    channelId: row.channelId,
    postId: row.postId,
    source: row.source as "manual" | "rule",
    status: row.status as "pending" | "active" | "rejected" | "removed",
    position: row.position,
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    addedByUserId: row.addedByUserId,
    reviewedByUserId: row.reviewedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function scheduleChannelMaterialization(tx: Prisma.TransactionClient, channelId: string) {
  const version = new Date();
  await tx.channel.update({ where: { id: channelId }, data: { updatedAt: version } });
  await enqueueChannelJob(tx, {
    idempotencyKey: `materialize:${channelId}:${version.toISOString()}`,
    kind: "materialize_channel",
    channelId
  });
}

export async function addChannelPost(
  actorUserId: string,
  channelId: string,
  input: ChannelPostMutationInput
) {
  return retryCurationSerializableOperation(() => prisma.$transaction(async (tx) => {
    const actor = await requireCurationAccess(tx, actorUserId, channelId, {
      allowMember: true,
      mutation: true
    });
    const post = await tx.post.findUnique({ where: { id: input.postId }, select: { id: true } });
    if (!post) throw new ChannelRepositoryError("Published post not found.", 404);
    const existing = await tx.channelPost.findUnique({
      where: { channelId_postId: { channelId, postId: input.postId } },
      select: { id: true, status: true, source: true }
    });
    if (!actor.curator) {
      if (Object.hasOwn(input, "position") || Object.hasOwn(input, "pinned")) {
        denied("Channel members cannot set ordering or pin state.");
      }
      if (existing) conflict("Channel members cannot replace an existing channel post.");
    }
    const exclusion = await tx.channelPostExclusion.findUnique({
      where: { channelId_postId: { channelId, postId: input.postId } },
      select: { id: true }
    });
    if (exclusion) conflict("Excluded posts cannot be actively added to the channel.");
    const status = actor.curator || actor.channel.memberPostPolicy === "direct" ? "active" : "pending";
    let channelPost = actor.curator
      ? await tx.channelPost.upsert({
          where: { channelId_postId: { channelId, postId: input.postId } },
          update: {
            source: "manual",
            status,
            ...(Object.hasOwn(input, "position") ? { position: input.position } : {}),
            ...(Object.hasOwn(input, "pinned") ? { pinnedAt: input.pinned ? new Date() : null } : {}),
            addedByUserId: actorUserId,
            reviewedByUserId: actorUserId
          },
          create: {
            channelId,
            postId: input.postId,
            source: "manual",
            status,
            position: input.position ?? null,
            pinnedAt: input.pinned ? new Date() : null,
            addedByUserId: actorUserId,
            reviewedByUserId: actorUserId
          }
        })
      : await tx.channelPost.create({
          data: {
            channelId,
            postId: input.postId,
            source: "manual",
            status,
            position: null,
            pinnedAt: null,
            addedByUserId: actorUserId,
            reviewedByUserId: status === "active" ? actorUserId : null
          }
        });
    if (actor.curator && Object.hasOwn(input, "position")) {
      await normalizeChannelPostPositions(tx, channelId, channelPost.id, input.position ?? null);
      channelPost = await tx.channelPost.findUniqueOrThrow({ where: { id: channelPost.id } });
    }
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: actor.role,
        action: "channel.post_add",
        targetType: "channel_post",
        targetId: channelPost.id,
        metadata: {
          channelId,
          postId: input.postId,
          previousStatus: existing?.status ?? null,
          previousSource: existing?.source ?? null,
          source: "manual",
          status
        }
      }
    });
    return mapChannelPostMutation(channelPost);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function updateChannelPost(
  actorUserId: string,
  channelId: string,
  channelPostId: string,
  input: ChannelPostPatchInput
) {
  return retryCurationSerializableOperation(() => prisma.$transaction(async (tx) => {
    const actor = await requireCurationAccess(tx, actorUserId, channelId, {
      allowMember: false,
      mutation: true
    });
    const current = await tx.channelPost.findFirst({ where: { id: channelPostId, channelId } });
    if (!current) throw new ChannelRepositoryError("Channel post not found.", 404);
    if (input.status === "active") {
      const exclusion = await tx.channelPostExclusion.findUnique({
        where: { channelId_postId: { channelId, postId: current.postId } },
        select: { id: true }
      });
      if (exclusion) conflict("Excluded posts cannot be activated.");
    }
    let channelPost = await tx.channelPost.update({
      where: { id: current.id },
      data: {
        ...(Object.hasOwn(input, "position") ? { position: input.position } : {}),
        ...(Object.hasOwn(input, "pinned") ? { pinnedAt: input.pinned ? new Date() : null } : {}),
        ...(input.status ? {
          status: input.status,
          reviewedByUserId: actorUserId
        } : {})
      }
    });
    if (Object.hasOwn(input, "position") || (input.status !== undefined && channelPost.position !== null)) {
      const desiredPosition = channelPost.status === "active" ? channelPost.position : null;
      await normalizeChannelPostPositions(tx, channelId, channelPost.id, desiredPosition);
      channelPost = await tx.channelPost.findUniqueOrThrow({ where: { id: channelPost.id } });
    }
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: actor.role,
        action: "channel.post_update",
        targetType: "channel_post",
        targetId: current.id,
        metadata: {
          channelId,
          postId: current.postId,
          previousStatus: current.status,
          status: channelPost.status,
          position: channelPost.position,
          pinned: channelPost.pinnedAt !== null
        }
      }
    });
    return mapChannelPostMutation(channelPost);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function removeChannelPost(actorUserId: string, channelId: string, channelPostId: string) {
  return updateChannelPost(actorUserId, channelId, channelPostId, { status: "removed" });
}

export async function listDashboardChannelPosts(
  actorUserId: string,
  channelId: string,
  input: { cursor?: string; limit?: number }
) {
  const limit = normalizeLimit(input.limit);
  const cursor = decodeRequiredCursor(input.cursor, "channel-feed", channelId);
  await prisma.$transaction((tx) => requireCurationAccess(tx, actorUserId, channelId, {
    allowMember: false,
    mutation: false
  }));
  const rows = await prisma.channelPost.findMany({
    where: {
      AND: [
        { channelId },
        ...(cursor ? [channelFeedAfterPredicate(cursor)] : [])
      ]
    },
    include: { post: { select: { createdAt: true } } },
    orderBy: [
      { pinnedAt: { sort: "desc", nulls: "last" } },
      { position: { sort: "asc", nulls: "last" } },
      { post: { createdAt: "desc" } },
      { id: "desc" }
    ],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const last = rows.at(-1);
  return {
    channelPosts: rows.map(mapChannelPostMutation),
    nextCursor: hasMore && last
      ? encodeChannelCursor({
          scope: "channel-feed",
          channelId,
          pinnedAt: last.pinnedAt?.toISOString() ?? null,
          position: last.position,
          createdAt: last.post.createdAt.toISOString(),
          id: last.id
        })
      : null
  };
}

export async function createChannelRule(
  actorUserId: string,
  channelId: string,
  input: ChannelRuleMutationInput
) {
  return prisma.$transaction(async (tx) => {
    const actor = await requireCurationAccess(tx, actorUserId, channelId, {
      allowMember: false,
      mutation: true
    });
    const rule = await tx.channelRule.create({
      data: { channelId, ...input, createdByUserId: actorUserId }
    });
    await scheduleChannelMaterialization(tx, channelId);
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: actor.role,
        action: "channel.rule_create",
        targetType: "channel_rule",
        targetId: rule.id,
        metadata: { channelId, kind: rule.kind, enabled: rule.enabled }
      }
    });
    return { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() };
  });
}

export async function updateChannelRule(
  actorUserId: string,
  channelId: string,
  ruleId: string,
  input: Partial<ChannelRuleMutationInput>
) {
  return prisma.$transaction(async (tx) => {
    const actor = await requireCurationAccess(tx, actorUserId, channelId, {
      allowMember: false,
      mutation: true
    });
    const current = await tx.channelRule.findFirst({ where: { id: ruleId, channelId } });
    if (!current) throw new ChannelRepositoryError("Channel rule not found.", 404);
    const rule = await tx.channelRule.update({ where: { id: current.id }, data: input });
    await scheduleChannelMaterialization(tx, channelId);
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: actor.role,
        action: "channel.rule_update",
        targetType: "channel_rule",
        targetId: current.id,
        metadata: { channelId, kind: rule.kind, enabled: rule.enabled }
      }
    });
    return { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() };
  });
}

export async function deleteChannelRule(actorUserId: string, channelId: string, ruleId: string) {
  return prisma.$transaction(async (tx) => {
    const actor = await requireCurationAccess(tx, actorUserId, channelId, {
      allowMember: false,
      mutation: true
    });
    const current = await tx.channelRule.findFirst({ where: { id: ruleId, channelId } });
    if (!current) return { changed: false };
    await tx.channelRule.delete({ where: { id: current.id } });
    await scheduleChannelMaterialization(tx, channelId);
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: actor.role,
        action: "channel.rule_delete",
        targetType: "channel_rule",
        targetId: current.id,
        metadata: { channelId, kind: current.kind }
      }
    });
    return { changed: true };
  });
}

export async function listChannelRules(
  actorUserId: string,
  channelId: string,
  input: { cursor?: string; limit?: number }
) {
  const limit = normalizeLimit(input.limit);
  const cursor = parseCurationCursor(input.cursor, "channel-rules", channelId);
  await prisma.$transaction((tx) => requireCurationAccess(tx, actorUserId, channelId, {
    allowMember: false,
    mutation: false
  }));
  const rows = await prisma.channelRule.findMany({
    where: {
      channelId,
      ...(cursor ? {
        OR: [
          { createdAt: { gt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }
        ]
      } : {})
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const last = rows.at(-1);
  return {
    rules: rows.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() })),
    nextCursor: hasMore && last
      ? encodeCurationCursor({ scope: "channel-rules", channelId, createdAt: last.createdAt.toISOString(), id: last.id })
      : null
  };
}

export async function createChannelExclusion(
  actorUserId: string,
  channelId: string,
  input: ChannelExclusionMutationInput
) {
  return retryCurationSerializableOperation(() => prisma.$transaction(async (tx) => {
    const actor = await requireCurationAccess(tx, actorUserId, channelId, {
      allowMember: false,
      mutation: true
    });
    const post = await tx.post.findUnique({ where: { id: input.postId }, select: { id: true } });
    if (!post) throw new ChannelRepositoryError("Published post not found.", 404);
    const exclusion = await tx.channelPostExclusion.upsert({
      where: { channelId_postId: { channelId, postId: input.postId } },
      update: { reason: input.reason, excludedByUserId: actorUserId },
      create: { channelId, postId: input.postId, reason: input.reason, excludedByUserId: actorUserId }
    });
    await tx.channelPost.updateMany({
      where: { channelId, postId: input.postId, status: { not: "removed" } },
      data: { status: "removed", reviewedByUserId: actorUserId }
    });
    await scheduleChannelMaterialization(tx, channelId);
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: actor.role,
        action: "channel.exclusion_create",
        targetType: "channel_exclusion",
        targetId: exclusion.id,
        metadata: { channelId, postId: input.postId }
      }
    });
    return { ...exclusion, createdAt: exclusion.createdAt.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function deleteChannelExclusion(
  actorUserId: string,
  channelId: string,
  exclusionId: string
) {
  return retryCurationSerializableOperation(() => prisma.$transaction(async (tx) => {
    const actor = await requireCurationAccess(tx, actorUserId, channelId, {
      allowMember: false,
      mutation: true
    });
    const current = await tx.channelPostExclusion.findFirst({ where: { id: exclusionId, channelId } });
    if (!current) return { changed: false };
    await tx.channelPostExclusion.delete({ where: { id: current.id } });
    await scheduleChannelMaterialization(tx, channelId);
    await tx.auditLog.create({
      data: {
        actorUserId,
        actorRole: actor.role,
        action: "channel.exclusion_delete",
        targetType: "channel_exclusion",
        targetId: current.id,
        metadata: { channelId, postId: current.postId }
      }
    });
    return { changed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function listChannelExclusions(
  actorUserId: string,
  channelId: string,
  input: { cursor?: string; limit?: number }
) {
  const limit = normalizeLimit(input.limit);
  const cursor = parseCurationCursor(input.cursor, "channel-exclusions", channelId);
  await prisma.$transaction((tx) => requireCurationAccess(tx, actorUserId, channelId, {
    allowMember: false,
    mutation: false
  }));
  const rows = await prisma.channelPostExclusion.findMany({
    where: {
      channelId,
      ...(cursor ? {
        OR: [
          { createdAt: { gt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }
        ]
      } : {})
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const last = rows.at(-1);
  return {
    exclusions: rows.map((exclusion) => ({ ...exclusion, createdAt: exclusion.createdAt.toISOString() })),
    nextCursor: hasMore && last
      ? encodeCurationCursor({ scope: "channel-exclusions", channelId, createdAt: last.createdAt.toISOString(), id: last.id })
      : null
  };
}
