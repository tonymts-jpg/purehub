import { Prisma } from "@prisma/client";
import { ADMIN_SECTIONS, type AdminContext } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getChannelAccess, resolveChannelAccess } from "./auth";
import {
  CHANNEL_KINDS,
  CHANNEL_QUOTAS,
  CHANNEL_STATUSES,
  CHANNEL_VISIBILITIES,
  type ChannelAccess,
  type ChannelCursor,
  type ChannelDetailDto,
  type ChannelDto,
  type ChannelJobInput,
  type ChannelLevelId,
  type ChannelPostDto,
  type ChannelPostPolicy,
  type ChannelStatus,
  type ChannelVisibility,
  type CreateChannelInput,
  type ListChannelsInput,
  encodeChannelCursor,
  parseChannelCursor,
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
  return ADMIN_SECTIONS[admin.role].includes("channels");
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

function decodeRequiredCursor(value: string | undefined): ChannelCursor | null {
  if (!value) return null;
  const cursor = parseChannelCursor(value);
  if (!cursor) throw new ChannelRepositoryError("Channel cursor is invalid.", 400);
  return cursor;
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
    return await prisma.$transaction(async (tx) => {
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

      if (status === "active") {
        const version = channel.updatedAt.toISOString();
        await enqueueChannelJob(tx, {
          idempotencyKey: `index:channel:${channel.id}:${version}`,
          kind: "index_entity",
          channelId: channel.id,
          entityType: "channel",
          entityId: channel.id
        });
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
        isAdmin: Boolean(admin)
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
      isAdmin: false
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

export async function listChannels(
  input: ListChannelsInput,
  viewerUserId: string | null
): Promise<{ channels: ChannelDto[]; nextCursor: string | null }> {
  const limit = normalizeLimit(input.limit);
  const cursor = decodeRequiredCursor(input.cursor);
  if (input.kind && !CHANNEL_KINDS.some((kind) => kind === input.kind)) {
    throw new ChannelRepositoryError("Channel kind is invalid.", 400);
  }
  if (input.visibility && !CHANNEL_VISIBILITIES.some((visibility) => visibility === input.visibility)) {
    throw new ChannelRepositoryError("Channel visibility is invalid.", 400);
  }
  if (input.status && !CHANNEL_STATUSES.some((status) => status === input.status)) {
    throw new ChannelRepositoryError("Channel status is invalid.", 400);
  }

  const activeAdmin = viewerUserId
    ? await prisma.adminAccount.findFirst({
        where: { userId: viewerUserId, status: "active", user: { status: "active" } },
        select: { id: true }
      })
    : null;
  const where: Prisma.ChannelWhereInput = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.visibility ? { visibility: input.visibility } : {})
  };

  if (activeAdmin) {
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
    where,
    include: channelOwnerInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {})
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const channels = await Promise.all(rows.map(async (channel) => mapChannel(
    channel,
    await getChannelAccess(viewerUserId, channel.id)
  )));
  const last = rows.at(-1);
  return {
    channels,
    nextCursor: hasMore && last
      ? encodeChannelCursor({
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
): Promise<ChannelDetailDto> {
  const cursor = decodeRequiredCursor(cursorValue);
  const channel = await prisma.channel.findUnique({
    where: { slug },
    include: channelOwnerInclude
  });
  if (!channel) notFound();

  const access = await getChannelAccess(viewerUserId, channel.id);
  const maySeeSafeSummary = channel.status === "active"
    && channel.visibility === "private"
    && channel.discoverability === "discoverable";
  if (!access.canRead && !maySeeSafeSummary) notFound();

  if (!access.canRead) {
    return { ...mapChannel(channel, access), posts: [], nextCursor: null };
  }

  const excluded = await prisma.channelPostExclusion.findMany({
    where: { channelId: channel.id },
    select: { postId: true }
  });
  const postRows = await prisma.channelPost.findMany({
    where: {
      channelId: channel.id,
      status: "active",
      ...(excluded.length ? { postId: { notIn: excluded.map((item) => item.postId) } } : {})
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
      { createdAt: "desc" },
      { id: "desc" }
    ],
    take: 21,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {})
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
          pinnedAt: last.pinnedAt?.toISOString() ?? null,
          position: last.position,
          createdAt: last.createdAt.toISOString(),
          id: last.id
        })
      : null
  };
}
