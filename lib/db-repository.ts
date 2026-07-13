import { Prisma } from "@prisma/client";
import { creators, posts, transactions } from "./data";
import { prisma } from "./prisma";
import type { ContentCategory } from "./categories";
import type { Comment, CreatorProfile, MediaAsset, Post, Transaction } from "./types";
import type { ContentType, SaleMode } from "./platform-config";
import { isSaleModeAllowed } from "./platform-config";

const postInclude = { media: { orderBy: { order: "asc" as const } } };
const creatorInclude = { creatorProfile: { include: { plans: true } } };

const canUseDatabase = () => Boolean(process.env.DATABASE_URL);

function normalizeJsonArray<T>(value: Prisma.JsonValue, fallback: T[]): T[] {
  return Array.isArray(value) ? value as T[] : fallback;
}

function mapMedia(asset: {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  order: number;
}): MediaAsset {
  return {
    id: asset.id,
    src: asset.src,
    alt: asset.alt,
    width: asset.width,
    height: asset.height,
    order: asset.order
  };
}

function mapPost(post: Prisma.PostGetPayload<{ include: typeof postInclude }>): Post {
  return {
    id: post.id,
    creatorId: post.creatorId,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    cover: post.cover,
    category: post.category as ContentCategory,
    tags: normalizeJsonArray<string>(post.tags, []),
    visibility: post.visibility as Post["visibility"],
    price: post.price ?? undefined,
    likes: post.likes,
    comments: normalizeJsonArray<Comment>(post.comments, []),
    createdAt: post.createdLabel,
    media: post.media.map(mapMedia)
  };
}

function mapCreator(user: Prisma.UserGetPayload<{ include: typeof creatorInclude }>): CreatorProfile | null {
  if (!user.creatorProfile) return null;
  return {
    id: user.id,
    name: user.name,
    handle: user.handle,
    avatar: user.avatar,
    role: "creator",
    bio: user.creatorProfile.bio,
    category: user.creatorProfile.category as ContentCategory,
    followers: user.creatorProfile.followers,
    members: user.creatorProfile.members,
    cover: user.creatorProfile.cover,
    verified: user.creatorProfile.verified,
    plans: user.creatorProfile.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      color: plan.color,
      benefits: normalizeJsonArray<string>(plan.benefits, [])
    }))
  };
}

function mapTransaction(transaction: {
  id: string;
  title: string;
  amount: number;
  type: string;
  dateLabel: string;
  status: string;
}): Transaction {
  return {
    id: transaction.id,
    title: transaction.title,
    amount: transaction.amount,
    type: transaction.type as Transaction["type"],
    date: transaction.dateLabel,
    status: transaction.status
  };
}

async function withFallback<T>(operation: () => Promise<T>, fallback: () => T): Promise<T> {
  if (!canUseDatabase()) return fallback();
  try {
    return await operation();
  } catch (error) {
    console.warn("PureHub repository fell back to demo data:", error);
    return fallback();
  }
}

export async function getFeed(filters?: { category?: ContentCategory }): Promise<Post[]> {
  return withFallback(
    async () => {
      const result = await prisma.post.findMany({
        where: filters?.category ? { category: filters.category } : undefined,
        include: postInclude,
        orderBy: { createdAt: "desc" }
      });
      return result.map(mapPost);
    },
    () => filters?.category ? posts.filter((post) => post.category === filters.category) : posts
  );
}

export async function getPost(id: string): Promise<Post | null> {
  return withFallback(
    async () => {
      const post = await prisma.post.findUnique({ where: { id }, include: postInclude });
      return post ? mapPost(post) : null;
    },
    () => posts.find((post) => post.id === id) ?? null
  );
}

export async function getCreator(handle: string): Promise<CreatorProfile | null> {
  return withFallback(
    async () => {
      const creator = await prisma.user.findUnique({ where: { handle }, include: creatorInclude });
      return creator ? mapCreator(creator) : null;
    },
    () => creators.find((creator) => creator.handle === handle) ?? null
  );
}

export async function getCreatorPosts(creatorId: string): Promise<Post[]> {
  return withFallback(
    async () => {
      const result = await prisma.post.findMany({
        where: { creatorId },
        include: postInclude,
        orderBy: { createdAt: "desc" }
      });
      return result.map(mapPost);
    },
    () => posts.filter((post) => post.creatorId === creatorId)
  );
}

export async function getDashboardSummary(creatorId = "c1") {
  return withFallback(
    async () => {
      const [wallet, creatorPosts, recentTransactions, members] = await Promise.all([
        prisma.walletBalance.findUnique({ where: { userId: creatorId } }),
        prisma.post.findMany({ where: { creatorId }, include: postInclude, orderBy: { createdAt: "desc" } }),
        prisma.transaction.findMany({ where: { userId: creatorId }, orderBy: { createdAt: "desc" }, take: 8 }),
        prisma.subscription.count({ where: { creatorId, status: "active" } })
      ]);
      return {
        balance: wallet?.available ?? 0,
        pending: wallet?.pending ?? 0,
        posts: creatorPosts.map(mapPost),
        transactions: recentTransactions.map(mapTransaction),
        members
      };
    },
    () => ({
      balance: 8620,
      pending: 1280,
      posts: posts.filter((post) => post.creatorId === creatorId),
      transactions,
      members: creators.find((creator) => creator.id === creatorId)?.members ?? 0
    })
  );
}

export async function getPriceTiers(input?: { levelId?: string; contentType?: ContentType; saleMode?: SaleMode }) {
  return withFallback(
    async () => prisma.priceTier.findMany({
      where: {
        active: true,
        pricingVersion: { status: "active" },
        levelId: input?.levelId,
        contentType: input?.contentType,
        saleMode: input?.saleMode
      },
      orderBy: [{ levelId: "asc" }, { contentType: "asc" }, { price: "asc" }]
    }),
    () => {
      const levelId = input?.levelId ?? "level-2";
      const contentType = input?.contentType ?? "photo_short";
      const saleMode = input?.saleMode ?? "single_plus_subscription";
      const prices = contentType === "long_video" ? [50, 80, 120] : saleMode === "subscription_only" ? [0] : [20, 40, 60];
      return prices.map((price) => ({
        id: `${levelId}-${contentType}-${saleMode}-${price}`,
        levelId,
        pricingVersionId: "pricing-v1",
        contentType,
        saleMode,
        price,
        currency: "CNY",
        active: true
      }));
    }
  );
}

export async function createPost(input: {
  creatorId?: string;
  title: string;
  excerpt: string;
  content: string;
  category: ContentCategory;
  visibility: Post["visibility"];
  contentType: ContentType;
  saleMode: SaleMode;
  price?: number;
}) {
  if (!isSaleModeAllowed(input.contentType, input.saleMode)) {
    throw new Error("Sale mode is not allowed for this content type.");
  }

  if (!canUseDatabase()) {
    return {
      id: `custom-${Date.now()}`,
      creatorId: input.creatorId ?? "c1",
      title: input.title,
      excerpt: input.excerpt,
      content: input.content,
      category: input.category,
      visibility: input.visibility,
      price: input.price,
      cover: "cover-1",
      tags: [input.category, "新发布"],
      likes: 0,
      comments: [],
      createdAt: "刚刚",
      media: []
    } satisfies Post;
  }

  const post = await prisma.post.create({
    data: {
      id: `custom-${Date.now()}`,
      creatorId: input.creatorId ?? "c1",
      title: input.title,
      excerpt: input.excerpt,
      content: input.content,
      category: input.category,
      visibility: input.visibility,
      contentType: input.contentType,
      saleMode: input.saleMode,
      price: input.price ?? null,
      cover: "cover-1",
      tags: [input.category, "新发布"],
      likes: 0,
      comments: [],
      createdLabel: "刚刚"
    },
    include: postInclude
  });
  return mapPost(post);
}

export async function createCreatorApplication(input: {
  userId?: string;
  displayName: string;
  category: string;
  portfolio: string;
  contact: string;
  note?: string;
}) {
  if (!canUseDatabase()) {
    return { id: `application-${Date.now()}`, status: "pending", ...input };
  }

  const userId = input.userId ?? "fan-demo";
  const fanHandle = userId === "fan-demo" ? "pure-fan" : `fan-${userId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40)}`;
  await prisma.user.upsert({
    where: { id: userId },
    update: { creatorStatus: "pending" },
    create: {
      id: userId,
      name: "Pure 粉丝",
      handle: fanHandle,
      avatar: "P",
      role: "fan",
      creatorStatus: "pending"
    }
  });

  return prisma.creatorApplication.create({
    data: {
      id: `application-${Date.now()}`,
      userId,
      displayName: input.displayName,
      category: input.category,
      portfolio: input.portfolio,
      contact: input.contact,
      note: input.note,
      status: "pending"
    }
  });
}

export async function reviewCreatorApplication(id: string, status: "approved" | "rejected") {
  if (!canUseDatabase()) return { id, status };

  const application = await prisma.creatorApplication.update({
    where: { id },
    data: { status, reviewedAt: new Date() }
  });

  await prisma.user.update({
    where: { id: application.userId },
    data: {
      role: status === "approved" ? "creator" : "fan",
      creatorStatus: status
    }
  });

  return application;
}

