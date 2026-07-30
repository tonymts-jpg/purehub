import { Prisma } from "@prisma/client";
import { ChannelRepositoryError, getChannelBySlug } from "@/lib/channels/repository";
import { addPostViewerState, mapDatabasePost } from "@/lib/db-repository";
import { prisma } from "@/lib/prisma";
import { encodeAccountCursor, parseAccountCursor } from "./cursor";
import type {
  AccountChannelFavoriteListItem,
  AccountCursor,
  AccountFollowingListItem,
  AccountListScope,
  AccountPostListItem,
  AccountUnlockedListItem,
  AccountUnlockedSource
} from "./types";

const favoritePostInclude = {
  post: {
    include: {
      media: { orderBy: { order: "asc" as const } }
    }
  }
} satisfies Prisma.BookmarkInclude;

const postHistoryInclude = {
  post: {
    include: {
      media: { orderBy: { order: "asc" as const } },
      creator: { select: { id: true, name: true, handle: true, avatar: true } }
    }
  }
} satisfies Prisma.PostViewHistoryInclude;

const likedPostInclude = {
  post: {
    include: {
      media: { orderBy: { order: "asc" as const } },
      creator: { select: { id: true, name: true, handle: true, avatar: true } }
    }
  }
} satisfies Prisma.PostLikeInclude;

const unlockedPostInclude = {
  post: {
    include: {
      media: { orderBy: { order: "asc" as const } }
    }
  }
} satisfies Prisma.EntitlementInclude;

const HISTORY_RETENTION_DAYS = 90;
const ACCOUNT_IDENTITY_OVERRIDE_HEADERS = [
  "x-user-id",
  "x-user-role",
  "x-admin-role"
] as const;

export class AccountRepositoryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404
  ) {
    super(message);
    this.name = "AccountRepositoryError";
  }
}

export type AccountListInput = {
  cursor?: string;
  limit?: number;
};

export type AccountListResponse<T> = {
  items: T[];
  nextCursor: string | null;
};

export function accountListInput(request: Request): AccountListInput {
  const searchParams = new URL(request.url).searchParams;
  const allowed = new Set(["cursor", "limit"]);
  for (const field of searchParams.keys()) {
    if (!allowed.has(field)) {
      throw new TypeError(`This request does not accept the ${field} query parameter.`);
    }
    if (searchParams.getAll(field).length > 1) {
      throw new TypeError(`The ${field} query parameter may be provided at most once.`);
    }
  }

  const cursor = searchParams.get("cursor");
  if (cursor !== null && cursor.length === 0) {
    throw new TypeError("Account cursor is invalid.");
  }
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
    throw new TypeError("Limit must be an integer between 1 and 50.");
  }
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if (limit !== undefined && (limit < 1 || limit > 50)) {
    throw new TypeError("Limit must be an integer between 1 and 50.");
  }
  return {
    ...(cursor ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
}

export function assertNoAccountIdentityOverrideHeaders(request: Request): void {
  for (const header of ACCOUNT_IDENTITY_OVERRIDE_HEADERS) {
    if (request.headers.has(header)) {
      throw new TypeError(`This request does not accept the ${header} header.`);
    }
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new AccountRepositoryError("Limit must be an integer between 1 and 50.", 400);
  }
  return value;
}

function decodeCursor(
  value: string | undefined,
  scope: AccountListScope
): AccountCursor | null {
  if (!value) return null;
  try {
    return parseAccountCursor(value, scope);
  } catch (error) {
    throw new AccountRepositoryError(
      error instanceof Error ? error.message : "Account cursor is invalid.",
      400
    );
  }
}

function relationAfterPredicate(cursor: AccountCursor): {
  OR: Array<
    | { createdAt: { lt: Date } }
    | { createdAt: Date; id: { lt: string } }
  >;
} {
  const createdAt = new Date(cursor.occurredAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: cursor.id } }
    ]
  };
}

function historyAfterPredicate(cursor: AccountCursor): {
  OR: Array<
    | { lastViewedAt: { lt: Date } }
    | { lastViewedAt: Date; id: { lt: string } }
  >;
} {
  const lastViewedAt = new Date(cursor.occurredAt);
  return {
    OR: [
      { lastViewedAt: { lt: lastViewedAt } },
      { lastViewedAt, id: { lt: cursor.id } }
    ]
  };
}

function nextCursor(
  scope: AccountListScope,
  hasMore: boolean,
  last: { createdAt: Date; id: string } | undefined
): string | null {
  return hasMore && last
    ? encodeAccountCursor({
        scope,
        occurredAt: last.createdAt.toISOString(),
        id: last.id
      })
    : null;
}

export async function listLikedPosts(
  userId: string,
  input: AccountListInput = {}
): Promise<AccountListResponse<AccountPostListItem>> {
  const scope = "likes";
  const limit = normalizeLimit(input.limit);
  const cursor = decodeCursor(input.cursor, scope);
  const rows = await prisma.postLike.findMany({
    where: {
      userId,
      ...(cursor ? { AND: [relationAfterPredicate(cursor)] } : {})
    },
    include: likedPostInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const returned = rows.slice(0, limit);
  const posts = await addPostViewerState(
    returned.map((row) => mapDatabasePost(row.post)),
    userId
  );
  return {
    items: returned.map((row, index) => ({
      post: posts[index],
      creator: row.post.creator,
      occurredAt: row.createdAt.toISOString()
    })),
    nextCursor: nextCursor(scope, hasMore, returned.at(-1))
  };
}

export async function listFollowingCreators(
  userId: string,
  input: AccountListInput = {}
): Promise<AccountListResponse<AccountFollowingListItem>> {
  const scope = "following";
  const limit = normalizeLimit(input.limit);
  const cursor = decodeCursor(input.cursor, scope);
  const rows = await prisma.follow.findMany({
    where: {
      userId,
      ...(cursor ? { AND: [relationAfterPredicate(cursor)] } : {})
    },
    select: {
      id: true,
      createdAt: true,
      creator: {
        select: {
          id: true,
          name: true,
          handle: true,
          avatar: true,
          creatorProfile: {
            select: {
              bio: true,
              category: true,
              verified: true
            }
          }
        }
      }
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const returned = rows.slice(0, limit);
  return {
    items: returned.map((row) => ({
      creator: {
        id: row.creator.id,
        name: row.creator.name,
        handle: row.creator.handle,
        avatar: row.creator.avatar,
        bio: row.creator.creatorProfile?.bio ?? null,
        category: row.creator.creatorProfile?.category ?? null,
        verified: row.creator.creatorProfile?.verified ?? false,
        following: true
      },
      occurredAt: row.createdAt.toISOString()
    })),
    nextCursor: nextCursor(scope, hasMore, returned.at(-1))
  };
}

type UnlockedCandidate = {
  id: string;
  createdAt: Date;
  source: AccountUnlockedSource;
  post: Prisma.PostGetPayload<{ include: { media: { orderBy: { order: "asc" } } } }>;
};

type UnlockedCursor = AccountCursor & {
  source: AccountUnlockedSource;
  relationId: string;
};

function unlockedCursorId(source: AccountUnlockedSource, relationId: string): string {
  return `${source}:${relationId}`;
}

function decodeUnlockedCursor(value: string | undefined): UnlockedCursor | null {
  const cursor = decodeCursor(value, "unlocked");
  if (!cursor) return null;
  for (const source of ["purchase", "subscription"] as const) {
    const prefix = `${source}:`;
    if (cursor.id.startsWith(prefix) && cursor.id.length > prefix.length) {
      return {
        ...cursor,
        source,
        relationId: cursor.id.slice(prefix.length)
      };
    }
  }
  throw new AccountRepositoryError("Account cursor is invalid.", 400);
}

function unlockedAfterPredicate(
  cursor: UnlockedCursor,
  source: AccountUnlockedSource
): {
  OR: Array<
    | { createdAt: { lt: Date } }
    | { createdAt: Date }
    | { createdAt: Date; id: { lt: string } }
  >;
} {
  const createdAt = new Date(cursor.occurredAt);
  const equalTime = source === cursor.source
    ? { createdAt, id: { lt: cursor.relationId } }
    : source === "subscription" && cursor.source === "purchase"
      ? { createdAt }
      : null;
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      ...(equalTime ? [equalTime] : [])
    ]
  };
}

export async function listUnlockedPosts(
  userId: string,
  input: AccountListInput = {}
): Promise<AccountListResponse<AccountUnlockedListItem>> {
  const scope = "unlocked";
  const limit = normalizeLimit(input.limit);
  const cursor = decodeUnlockedCursor(input.cursor);
  const activeSubscriptions = await prisma.subscription.findMany({
    where: { userId, status: "active" },
    select: { creatorId: true }
  });
  const activeCreatorIds = [...new Set(activeSubscriptions.map((row) => row.creatorId))];
  const [purchaseRows, subscriptionPosts] = await Promise.all([
    prisma.entitlement.findMany({
      where: {
        userId,
        source: "purchase",
        ...(cursor ? { AND: [unlockedAfterPredicate(cursor, "purchase")] } : {})
      },
      include: unlockedPostInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1
    }),
    activeCreatorIds.length
      ? prisma.post.findMany({
          where: {
            creatorId: { in: activeCreatorIds },
            visibility: { not: "free" },
            entitlements: { none: { userId, source: "purchase" } },
            ...(cursor ? { AND: [unlockedAfterPredicate(cursor, "subscription")] } : {})
          },
          include: { media: { orderBy: { order: "asc" } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1
        })
      : []
  ]);
  const candidates: UnlockedCandidate[] = [
    ...purchaseRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      source: "purchase" as const,
      post: row.post
    })),
    ...subscriptionPosts.map((post) => ({
      id: post.id,
      createdAt: post.createdAt,
      source: "subscription" as const,
      post
    }))
  ].sort((left, right) => {
    const timeDifference = right.createdAt.getTime() - left.createdAt.getTime();
    if (timeDifference) return timeDifference;
    if (left.source !== right.source) return left.source === "purchase" ? -1 : 1;
    if (left.id === right.id) return 0;
    return left.id < right.id ? 1 : -1;
  });
  const hasMore = candidates.length > limit;
  const returned = candidates.slice(0, limit);
  const posts = await addPostViewerState(
    returned.map((row) => mapDatabasePost(row.post)),
    userId
  );
  const items = returned.flatMap((row, index) => {
    const post = posts[index];
    return post.hasAccess
      ? [{
          post,
          source: row.source,
          occurredAt: row.createdAt.toISOString()
        }]
      : [];
  });
  return {
    items,
    nextCursor: nextCursor(scope, hasMore, returned.at(-1)
      ? {
          ...returned.at(-1)!,
          id: unlockedCursorId(returned.at(-1)!.source, returned.at(-1)!.id)
        }
      : undefined)
  };
}

export async function listFavoritePosts(
  userId: string,
  input: AccountListInput = {}
): Promise<AccountListResponse<Awaited<ReturnType<typeof addPostViewerState>>[number]>> {
  const scope = "favorite-posts";
  const limit = normalizeLimit(input.limit);
  const cursor = decodeCursor(input.cursor, scope);
  const rows = await prisma.bookmark.findMany({
    where: {
      userId,
      ...(cursor ? { AND: [relationAfterPredicate(cursor)] } : {})
    },
    include: favoritePostInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const returned = rows.slice(0, limit);
  const items = await addPostViewerState(
    returned.map((row) => mapDatabasePost(row.post)),
    userId
  );
  return {
    items,
    nextCursor: nextCursor(scope, hasMore, returned.at(-1))
  };
}

export async function listFavoriteChannels(
  userId: string,
  input: AccountListInput = {}
): Promise<AccountListResponse<AccountChannelFavoriteListItem>> {
  const scope = "favorite-channels";
  const limit = normalizeLimit(input.limit);
  const cursor = decodeCursor(input.cursor, scope);
  let scanCursor = cursor;
  let exhausted = false;
  const visibleRows: Array<{
    relation: { id: string; createdAt: Date };
    item: Awaited<ReturnType<typeof getChannelBySlug>> & { bookmarked: true };
  }> = [];

  while (visibleRows.length < limit + 1 && !exhausted) {
    const rows = await prisma.channelBookmark.findMany({
      where: {
        userId,
        ...(scanCursor ? { AND: [relationAfterPredicate(scanCursor)] } : {})
      },
      select: {
        id: true,
        createdAt: true,
        channel: { select: { slug: true } }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1
    });
    if (!rows.length) break;

    const visible = await Promise.all(rows.map(async (row) => {
      try {
        return {
          relation: { id: row.id, createdAt: row.createdAt },
          item: { ...(await getChannelBySlug(row.channel.slug, userId)), bookmarked: true as const }
        };
      } catch (error) {
        if (error instanceof ChannelRepositoryError && error.status === 404) return null;
        throw error;
      }
    }));
    visibleRows.push(...visible.filter((row) => row !== null));
    exhausted = rows.length < limit + 1;
    const last = rows.at(-1)!;
    scanCursor = {
      scope,
      occurredAt: last.createdAt.toISOString(),
      id: last.id
    };
  }

  const hasMore = visibleRows.length > limit;
  const returned = visibleRows.slice(0, limit);
  return {
    items: returned.map((row) => ({
      channel: row.item,
      occurredAt: row.relation.createdAt.toISOString()
    })),
    nextCursor: nextCursor(scope, hasMore, returned.at(-1)?.relation)
  };
}

export async function recordPostView(
  userId: string,
  postId: string,
  now = new Date()
) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true }
  });
  if (!post) throw new AccountRepositoryError("Post not found.", 404);

  return prisma.postViewHistory.upsert({
    where: { userId_postId: { userId, postId } },
    update: { lastViewedAt: now },
    create: {
      userId,
      postId,
      firstViewedAt: now,
      lastViewedAt: now
    }
  });
}

export async function listPostHistory(
  userId: string,
  input: AccountListInput = {},
  now = new Date()
): Promise<AccountListResponse<AccountPostListItem>> {
  const scope = "history";
  const limit = normalizeLimit(input.limit);
  const cursor = decodeCursor(input.cursor, scope);
  const cutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * 86_400_000);
  const rows = await prisma.postViewHistory.findMany({
    where: {
      userId,
      lastViewedAt: { gte: cutoff },
      ...(cursor ? { AND: [historyAfterPredicate(cursor)] } : {})
    },
    include: postHistoryInclude,
    orderBy: [{ lastViewedAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const returned = rows.slice(0, limit);
  const posts = await addPostViewerState(
    returned.map((row) => mapDatabasePost(row.post)),
    userId
  );
  const last = returned.at(-1);
  return {
    items: returned.map((row, index) => ({
      post: posts[index],
      creator: row.post.creator,
      occurredAt: row.lastViewedAt.toISOString()
    })),
    nextCursor: hasMore && last
      ? encodeAccountCursor({
          scope,
          occurredAt: last.lastViewedAt.toISOString(),
          id: last.id
        })
      : null
  };
}

export async function deleteExpiredPostViews(now = new Date()) {
  const cutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * 86_400_000);
  const result = await prisma.postViewHistory.deleteMany({
    where: { lastViewedAt: { lt: cutoff } }
  });
  return { deleted: result.count };
}

export async function setChannelBookmark(
  userId: string,
  slug: string,
  bookmarked: boolean
): Promise<{ bookmarked: boolean }> {
  let channelId: string;
  try {
    const visible = await getChannelBySlug(slug, userId);
    if ("id" in visible) {
      channelId = visible.id;
    } else {
      const channel = await prisma.channel.findUnique({
        where: { slug },
        select: { id: true }
      });
      if (!channel) throw new AccountRepositoryError("Channel not found.", 404);
      channelId = channel.id;
    }
  } catch (error) {
    if (
      error instanceof AccountRepositoryError
      || (error instanceof ChannelRepositoryError && error.status === 404)
    ) {
      throw new AccountRepositoryError("Channel not found.", 404);
    }
    throw error;
  }

  if (bookmarked) {
    await prisma.channelBookmark.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: {},
      create: { userId, channelId }
    });
  } else {
    await prisma.channelBookmark.deleteMany({
      where: { userId, channelId }
    });
  }
  return { bookmarked };
}
