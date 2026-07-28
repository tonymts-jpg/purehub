import { Prisma } from "@prisma/client";
import type {
  SearchInput,
  SearchResult
} from "@/lib/channels/types";
import type { AdminContext } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  SEARCH_ENTITY_TYPES,
  type SearchEntityType
} from "@/lib/search/jobs";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_CURSOR_VERSION = 1;
export const SEARCH_REINDEX_BATCH_SIZE = 25;
export const SEARCH_REINDEX_STAGES = [
  "post-source",
  "creator-source",
  "channel-source",
  "post-document",
  "creator-document",
  "channel-document",
  "done"
] as const;
export type SearchReindexStage = (typeof SEARCH_REINDEX_STAGES)[number];

type SearchCursorPayload = {
  version: typeof SEARCH_CURSOR_VERSION;
  query: string;
  type: SearchEntityType | null;
  rank: number;
  publishedAt: string;
  entityType: SearchEntityType;
  entityId: string;
};

export type SearchCursorInput = Omit<SearchCursorPayload, "version">;

export type NormalizedSearchInput = {
  query: string;
  type?: SearchEntityType;
  limit: number;
  cursor: SearchCursorPayload | null;
};

type SearchRow = {
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  body: string;
  rank: number;
  publishedAt: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSearchEntityType(value: unknown): value is SearchEntityType {
  return typeof value === "string"
    && SEARCH_ENTITY_TYPES.some((entityType) => entityType === value);
}

function isExactIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Search query is required.");
  const query = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (query.length < 2 || query.length > 100) {
    throw new TypeError("Search query must be between 2 and 100 characters.");
  }
  return query;
}

export function encodeSearchCursor(input: SearchCursorInput): string {
  if (
    !isSearchEntityType(input.entityType)
    || !input.entityId
    || !Number.isFinite(input.rank)
    || !isExactIsoDate(input.publishedAt)
    || (input.type !== undefined && input.type !== null && !isSearchEntityType(input.type))
  ) {
    throw new TypeError("Search cursor is invalid.");
  }
  const payload: SearchCursorPayload = {
    version: SEARCH_CURSOR_VERSION,
    query: normalizeQuery(input.query),
    type: input.type ?? null,
    rank: input.rank,
    publishedAt: input.publishedAt,
    entityType: input.entityType,
    entityId: input.entityId
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function parseSearchCursor(
  value: string,
  expectedQuery: string,
  expectedType?: SearchEntityType
): SearchCursorPayload {
  try {
    if (!value) throw new TypeError("Search cursor is invalid.");
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(parsed)) throw new TypeError("Search cursor is invalid.");
    const keys = Object.keys(parsed).sort();
    const expectedKeys = [
      "entityId",
      "entityType",
      "publishedAt",
      "query",
      "rank",
      "type",
      "version"
    ];
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
      throw new TypeError("Search cursor is invalid.");
    }
    if (
      parsed.version !== SEARCH_CURSOR_VERSION
      || typeof parsed.query !== "string"
      || (parsed.type !== null && !isSearchEntityType(parsed.type))
      || !Number.isFinite(parsed.rank)
      || !isExactIsoDate(parsed.publishedAt)
      || !isSearchEntityType(parsed.entityType)
      || typeof parsed.entityId !== "string"
      || !parsed.entityId
    ) {
      throw new TypeError("Search cursor is invalid.");
    }
    const query = normalizeQuery(expectedQuery);
    const type = expectedType ?? null;
    if (parsed.query !== query || parsed.type !== type) {
      throw new TypeError("Search cursor does not match this search.");
    }
    return parsed as SearchCursorPayload;
  } catch (error) {
    if (error instanceof TypeError && error.message === "Search cursor does not match this search.") {
      throw error;
    }
    throw new TypeError("Search cursor is invalid.");
  }
}

export function normalizeSearchInput(input: SearchInput): NormalizedSearchInput {
  if (!isRecord(input)) throw new TypeError("Search input must be an object.");
  const query = normalizeQuery(input.query);
  if (input.type !== undefined && !isSearchEntityType(input.type)) {
    throw new TypeError("Search type must be post, creator, or channel.");
  }
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new TypeError(`Search limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}.`);
  }
  const cursor = input.cursor === undefined
    ? null
    : parseSearchCursor(input.cursor, query, input.type);
  return {
    query,
    ...(input.type ? { type: input.type } : {}),
    limit,
    cursor
  };
}

function stringTags(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function deleteSearchDocument(entityType: SearchEntityType, entityId: string): Promise<"deleted"> {
  await prisma.searchDocument.deleteMany({ where: { entityType, entityId } });
  return "deleted";
}

export async function synchronizeSearchEntity(
  entityType: SearchEntityType,
  entityId: string
): Promise<"upserted" | "deleted"> {
  if (!isSearchEntityType(entityType) || !entityId) {
    throw new TypeError("Search entity type and ID are required.");
  }

  if (entityType === "post") {
    const post = await prisma.post.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        title: true,
        excerpt: true,
        content: true,
        category: true,
        tags: true,
        visibility: true,
        likes: true,
        createdAt: true,
        creator: {
          select: { status: true, role: true, creatorStatus: true }
        }
      }
    });
    if (
      !post
      || post.visibility !== "free"
      || post.creator.status !== "active"
      || post.creator.role !== "creator"
      || post.creator.creatorStatus !== "approved"
    ) {
      return deleteSearchDocument(entityType, entityId);
    }
    await prisma.searchDocument.upsert({
      where: { entityType_entityId: { entityType, entityId } },
      update: {
        title: post.title,
        body: `${post.excerpt} ${post.content}`.trim(),
        keywords: [post.category, ...stringTags(post.tags)].join(" "),
        popularityScore: post.likes,
        publishedAt: post.createdAt
      },
      create: {
        entityType,
        entityId,
        title: post.title,
        body: `${post.excerpt} ${post.content}`.trim(),
        keywords: [post.category, ...stringTags(post.tags)].join(" "),
        popularityScore: post.likes,
        publishedAt: post.createdAt
      }
    });
    return "upserted";
  }

  if (entityType === "creator") {
    const creator = await prisma.user.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        name: true,
        handle: true,
        status: true,
        role: true,
        creatorStatus: true,
        createdAt: true,
        creatorProfile: {
          select: { bio: true, category: true, followers: true }
        }
      }
    });
    if (
      !creator
      || !creator.creatorProfile
      || creator.status !== "active"
      || creator.role !== "creator"
      || creator.creatorStatus !== "approved"
    ) {
      return deleteSearchDocument(entityType, entityId);
    }
    const projection = {
      title: creator.name,
      body: creator.creatorProfile.bio,
      keywords: `${creator.handle} ${creator.creatorProfile.category}`,
      popularityScore: creator.creatorProfile.followers,
      publishedAt: creator.createdAt
    };
    await prisma.searchDocument.upsert({
      where: { entityType_entityId: { entityType, entityId } },
      update: projection,
      create: { entityType, entityId, ...projection }
    });
    return "upserted";
  }

  const channel = await prisma.channel.findUnique({
    where: { id: entityId },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      kind: true,
      visibility: true,
      discoverability: true,
      status: true,
      createdAt: true
    }
  });
  const eligible = channel?.status === "active"
    && (
      channel.visibility === "public"
      || (channel.visibility === "private" && channel.discoverability === "discoverable")
    );
  if (!channel || !eligible) return deleteSearchDocument(entityType, entityId);
  const projection = {
    title: channel.name,
    body: channel.description,
    keywords: [
      channel.slug,
      channel.kind,
      channel.visibility,
      channel.discoverability
    ].join(" "),
    popularityScore: 0,
    publishedAt: channel.createdAt
  };
  await prisma.searchDocument.upsert({
    where: { entityType_entityId: { entityType, entityId } },
    update: projection,
    create: { entityType, entityId, ...projection }
  });
  return "upserted";
}

function isSearchReindexStage(value: unknown): value is SearchReindexStage {
  return typeof value === "string"
    && SEARCH_REINDEX_STAGES.some((stage) => stage === value);
}

export function advanceSearchReindexStage(stage: string): SearchReindexStage {
  if (!isSearchReindexStage(stage) || stage === "done") {
    throw new TypeError("Search reindex stage is invalid.");
  }
  return SEARCH_REINDEX_STAGES[SEARCH_REINDEX_STAGES.indexOf(stage) + 1];
}

async function reindexStageEntityIds(
  stage: Exclude<SearchReindexStage, "done">,
  cursor: string | null,
  limit: number
): Promise<Array<{ entityId: string; entityType: SearchEntityType }>> {
  const after = cursor ? { gt: cursor } : undefined;
  if (stage === "post-source") {
    const rows = await prisma.post.findMany({
      where: { id: after },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true }
    });
    return rows.map(({ id }) => ({ entityType: "post", entityId: id }));
  }
  if (stage === "creator-source") {
    const rows = await prisma.creatorProfile.findMany({
      where: { userId: after },
      orderBy: { userId: "asc" },
      take: limit,
      select: { userId: true }
    });
    return rows.map(({ userId }) => ({ entityType: "creator", entityId: userId }));
  }
  if (stage === "channel-source") {
    const rows = await prisma.channel.findMany({
      where: { id: after },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true }
    });
    return rows.map(({ id }) => ({ entityType: "channel", entityId: id }));
  }
  const entityType = stage.replace("-document", "") as SearchEntityType;
  const rows = await prisma.searchDocument.findMany({
    where: { entityType, entityId: after },
    orderBy: { entityId: "asc" },
    take: limit,
    select: { entityId: true }
  });
  return rows.map(({ entityId }) => ({ entityType, entityId }));
}

export async function runSearchReindexBatch(input: {
  stage: string | null;
  cursor: string | null;
  limit?: number;
}): Promise<{
  completed: boolean;
  stage: SearchReindexStage;
  cursor: string | null;
  processed: number;
}> {
  const stage = input.stage ?? "post-source";
  const limit = input.limit ?? SEARCH_REINDEX_BATCH_SIZE;
  if (!isSearchReindexStage(stage)) throw new TypeError("Search reindex stage is invalid.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("Search reindex batch limit must be an integer between 1 and 100.");
  }
  if (stage === "done") {
    return { completed: true, stage, cursor: null, processed: 0 };
  }
  const rows = await reindexStageEntityIds(stage, input.cursor, limit);
  for (const row of rows) {
    await synchronizeSearchEntity(row.entityType, row.entityId);
  }
  if (rows.length === limit) {
    return {
      completed: false,
      stage,
      cursor: rows.at(-1)!.entityId,
      processed: rows.length
    };
  }
  const nextStage = advanceSearchReindexStage(stage);
  return {
    completed: nextStage === "done",
    stage: nextStage,
    cursor: null,
    processed: rows.length
  };
}

export async function requestSearchReindex(admin: AdminContext): Promise<{
  job: {
    id: string;
    status: string;
    idempotencyKey: string;
    entityType: string | null;
    entityId: string | null;
    attempts: number;
  };
  progress: { stage: string; cursor: string | null };
  enqueued: boolean;
}> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtext('purehub:phase7:search-reindex'))
    `;
    const existing = await tx.channelJob.findFirst({
      where: {
        kind: "reindex_all",
        status: { in: ["pending", "processing", "failed"] },
        attempts: { lt: 8 }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        idempotencyKey: true,
        entityType: true,
        entityId: true,
        attempts: true
      }
    });
    if (existing) {
      return {
        job: existing,
        progress: { stage: existing.entityType ?? "post-source", cursor: existing.entityId },
        enqueued: false
      };
    }

    const requestedAt = new Date();
    const job = await tx.channelJob.create({
      data: {
        idempotencyKey: `reindex-all:${requestedAt.toISOString()}`,
        kind: "reindex_all",
        entityType: "post-source"
      },
      select: {
        id: true,
        status: true,
        idempotencyKey: true,
        entityType: true,
        entityId: true,
        attempts: true
      }
    });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.actorUserId,
        actorRole: admin.role,
        action: "search.reindex",
        targetType: "channel_job",
        targetId: job.id,
        metadata: { idempotencyKey: job.idempotencyKey }
      }
    });
    return {
      job,
      progress: { stage: job.entityType ?? "post-source", cursor: job.entityId },
      enqueued: true
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function searchEntities(
  input: SearchInput,
  viewerUserId: string | null
): Promise<{ results: SearchResult[]; nextCursor: string | null }> {
  void viewerUserId;
  const normalized = normalizeSearchInput(input);
  const typeFilter = normalized.type
    ? Prisma.sql`AND document."entityType" = ${normalized.type}`
    : Prisma.empty;
  const afterCursor = normalized.cursor
    ? Prisma.sql`AND (
        ranked."rank" < ${normalized.cursor.rank}
        OR (
          ranked."rank" = ${normalized.cursor.rank}
          AND ranked."publishedAt" < ${new Date(normalized.cursor.publishedAt)}
        )
        OR (
          ranked."rank" = ${normalized.cursor.rank}
          AND ranked."publishedAt" = ${new Date(normalized.cursor.publishedAt)}
          AND ranked."entityType" > ${normalized.cursor.entityType}
        )
        OR (
          ranked."rank" = ${normalized.cursor.rank}
          AND ranked."publishedAt" = ${new Date(normalized.cursor.publishedAt)}
          AND ranked."entityType" = ${normalized.cursor.entityType}
          AND ranked."entityId" > ${normalized.cursor.entityId}
        )
      )`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    WITH ranked AS (
      SELECT
        document."entityType",
        document."entityId",
        document."title",
        document."body",
        document."publishedAt",
        round((
          ts_rank_cd(
            document."searchVector",
            websearch_to_tsquery('simple', ${normalized.query})
          ) * 1.0
          + similarity(lower(document."title"), lower(${normalized.query})) * 0.35
          + LEAST(document."popularityScore", 100000) / 100000.0 * 0.05
        )::numeric, 12)::double precision AS "rank"
      FROM "SearchDocument" AS document
      WHERE (
        document."searchVector" @@ websearch_to_tsquery('simple', ${normalized.query})
        OR similarity(lower(document."title"), lower(${normalized.query})) > 0.1
      )
      ${typeFilter}
      AND (
        (
          document."entityType" = 'post'
          AND EXISTS (
            SELECT 1
            FROM "Post" AS post
            JOIN "User" AS creator ON creator."id" = post."creatorId"
            WHERE post."id" = document."entityId"
              AND post."visibility" = 'free'
              AND creator."status" = 'active'
              AND creator."role" = 'creator'
              AND creator."creatorStatus" = 'approved'
          )
        )
        OR (
          document."entityType" = 'creator'
          AND EXISTS (
            SELECT 1
            FROM "User" AS creator
            JOIN "CreatorProfile" AS profile ON profile."userId" = creator."id"
            WHERE creator."id" = document."entityId"
              AND creator."status" = 'active'
              AND creator."role" = 'creator'
              AND creator."creatorStatus" = 'approved'
          )
        )
        OR (
          document."entityType" = 'channel'
          AND EXISTS (
            SELECT 1
            FROM "Channel" AS channel
            WHERE channel."id" = document."entityId"
              AND channel."status" = 'active'
              AND (
                channel."visibility" = 'public'
                OR (
                  channel."visibility" = 'private'
                  AND channel."discoverability" = 'discoverable'
                )
              )
          )
        )
      )
    )
    SELECT
      ranked."entityType",
      ranked."entityId",
      ranked."title",
      ranked."body",
      ranked."publishedAt",
      ranked."rank"
    FROM ranked
    WHERE TRUE
    ${afterCursor}
    ORDER BY
      ranked."rank" DESC,
      ranked."publishedAt" DESC,
      ranked."entityType" ASC,
      ranked."entityId" ASC
    LIMIT ${normalized.limit + 1}
  `);

  const pageRows = rows.slice(0, normalized.limit);
  const postIds = pageRows
    .filter(({ entityType }) => entityType === "post")
    .map(({ entityId }) => entityId);
  const channelIds = pageRows
    .filter(({ entityType }) => entityType === "channel")
    .map(({ entityId }) => entityId);
  const creatorIds = pageRows
    .filter(({ entityType }) => entityType === "creator")
    .map(({ entityId }) => entityId);
  const [media, channels, creators] = await Promise.all([
    postIds.length
      ? prisma.mediaAsset.findMany({
          where: {
            postId: { in: postIds },
            status: "ready",
            visibility: "public"
          },
          select: { postId: true, src: true, alt: true, kind: true, order: true, id: true },
          orderBy: [{ postId: "asc" }, { order: "asc" }, { id: "asc" }]
        })
      : [],
    channelIds.length
      ? prisma.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, slug: true }
        })
      : [],
    creatorIds.length
      ? prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, handle: true }
        })
      : []
  ]);
  const previewsByPostId = new Map<string, SearchResult["preview"]>();
  for (const asset of media) {
    if (!asset.postId || previewsByPostId.has(asset.postId)) continue;
    previewsByPostId.set(asset.postId, {
      src: asset.src,
      alt: asset.alt,
      kind: asset.kind === "video" ? "video" : "image"
    });
  }
  const channelSlugs = new Map(channels.map(({ id, slug }) => [id, slug]));
  const creatorHandles = new Map(creators.map(({ id, handle }) => [id, handle]));
  const results: SearchResult[] = pageRows.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    summary: row.body.slice(0, 280),
    rank: row.rank,
    publishedAt: row.publishedAt.toISOString(),
    href: row.entityType === "post"
      ? `/post/${row.entityId}`
      : row.entityType === "creator"
        ? `/creator/${creatorHandles.get(row.entityId) ?? row.entityId}`
        : `/channels/${channelSlugs.get(row.entityId) ?? row.entityId}`,
    preview: row.entityType === "post" ? previewsByPostId.get(row.entityId) ?? null : null
  }));
  const last = pageRows.at(-1);
  const nextCursor = rows.length > normalized.limit && last
    ? encodeSearchCursor({
        query: normalized.query,
        type: normalized.type ?? null,
        rank: last.rank,
        publishedAt: last.publishedAt.toISOString(),
        entityType: last.entityType,
        entityId: last.entityId
      })
    : null;
  return { results, nextCursor };
}
