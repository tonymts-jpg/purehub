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
  const rows = await prisma.channelBookmark.findMany({
    where: {
      userId,
      ...(cursor ? { AND: [relationAfterPredicate(cursor)] } : {})
    },
    select: {
      id: true,
      createdAt: true,
      channel: { select: { slug: true } }
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const returned = rows.slice(0, limit);
  const visible = await Promise.all(returned.map(async (row) => {
    try {
      return { ...(await getChannelBySlug(row.channel.slug, userId)), bookmarked: true };
    } catch (error) {
      if (error instanceof ChannelRepositoryError && error.status === 404) return null;
      throw error;
    }
  }));
  return {
    items: visible.filter((item) => item !== null),
    nextCursor: nextCursor(scope, hasMore, returned.at(-1))
  };
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
