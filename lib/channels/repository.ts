import { Prisma } from "@prisma/client";
import { CHANNEL_ADMIN_ROLES, isChannelAdminRole, type AdminContext } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getChannelAccess, resolveChannelAccess } from "./auth";
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
  type ChannelPatchInput,
  type ChannelPostDto,
  type ChannelPostPolicy,
  type ChannelStatus,
  type ChannelVisibility,
  type CreateChannelInput,
  type ListChannelsInput,
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
        lastError: true,
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

export async function listChannels(
  input: ListChannelsInput,
  viewerUserId: string | null
): Promise<{ channels: ChannelListItemDto[]; nextCursor: string | null }> {
  validateListInput(input);
  const limit = normalizeLimit(input.limit);
  const cursor = decodeRequiredCursor(input.cursor, "channel-list");

  const activeAdmin = viewerUserId
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

  if (hasAdminVisibility) {
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
    const access = await getChannelAccess(viewerUserId, channel.id);
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
  cursorValue?: string
): Promise<ChannelDetailResultDto> {
  const channel = await prisma.channel.findUnique({
    where: { slug },
    include: channelOwnerInclude
  });
  if (!channel) notFound();
  const cursor = decodeRequiredCursor(cursorValue, "channel-feed", channel.id);

  const access = await getChannelAccess(viewerUserId, channel.id);
  const maySeeSafeSummary = channel.status === "active"
    && channel.visibility === "private"
    && channel.discoverability === "discoverable";
  if (!access.canRead && !maySeeSafeSummary) notFound();

  if (!access.canRead) {
    return projectChannelSafeSummary(channel);
  }

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
