import { Prisma } from "@prisma/client";
import { ChannelRepositoryError, getChannelBySlug } from "@/lib/channels/repository";
import { addPostViewerState, mapDatabasePost } from "@/lib/db-repository";
import { prisma } from "@/lib/prisma";
import { encodeAccountCursor, parseAccountCursor } from "./cursor";
import type { AccountCursor, AccountListScope } from "./types";

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
      media: { orderBy: { order: "asc" as const } }
    }
  }
} satisfies Prisma.PostViewHistoryInclude;

const HISTORY_RETENTION_DAYS = 90;

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
) {
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
    items: returned.map((row) => row.item),
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
): Promise<AccountListResponse<Awaited<ReturnType<typeof addPostViewerState>>[number]>> {
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
  const items = await addPostViewerState(
    returned.map((row) => mapDatabasePost(row.post)),
    userId
  );
  const last = returned.at(-1);
  return {
    items,
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
