import { Prisma, PrismaClient } from "@prisma/client";
import { creators, posts, transactions } from "../lib/data";

const prisma = new PrismaClient();
const json = (value: unknown) => value as Prisma.InputJsonValue;

const levelForFollowers = (followers: number) => {
  if (followers >= 100_000) return "level-3";
  if (followers >= 50_000) return "level-2";
  return "level-1";
};

async function main() {
  await prisma.$transaction([
    prisma.entitlement.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.bookmark.deleteMany(),
    prisma.follow.deleteMany(),
    prisma.mediaAsset.deleteMany(),
    prisma.post.deleteMany(),
    prisma.membershipPlan.deleteMany(),
    prisma.creatorApplication.deleteMany(),
    prisma.payoutRequest.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.walletBalance.deleteMany(),
    prisma.creatorProfile.deleteMany(),
    prisma.user.deleteMany(),
    prisma.priceTier.deleteMany(),
    prisma.creatorLevel.deleteMany()
  ]);

  await prisma.creatorLevel.createMany({
    data: [
      { id: "level-1", name: "Starter", minFollowers: 0, maxFollowers: 49_999 },
      { id: "level-2", name: "Rising", minFollowers: 50_000, maxFollowers: 99_999 },
      { id: "level-3", name: "Premium", minFollowers: 100_000, maxFollowers: null }
    ]
  });

  const priceTiers = [
    ["level-1", "photo_short", "single_plus_subscription", [10, 20, 30]],
    ["level-1", "photo_short", "subscription_only", [0]],
    ["level-1", "long_video", "long_video_single", [30, 50, 80]],
    ["level-2", "photo_short", "single_plus_subscription", [20, 40, 60]],
    ["level-2", "photo_short", "subscription_only", [0]],
    ["level-2", "long_video", "long_video_single", [50, 80, 120]],
    ["level-3", "photo_short", "single_plus_subscription", [30, 60, 98]],
    ["level-3", "photo_short", "subscription_only", [0]],
    ["level-3", "long_video", "long_video_single", [80, 128, 198]]
  ] as const;

  await prisma.priceTier.createMany({
    data: priceTiers.flatMap(([levelId, contentType, saleMode, prices]) =>
      prices.map((price) => ({
        id: `${levelId}-${contentType}-${saleMode}-${price}`,
        levelId,
        contentType,
        saleMode,
        price,
        currency: "CNY",
        active: true
      }))
    )
  });

  await prisma.user.create({
    data: {
      id: "fan-demo",
      name: "Pure 粉丝",
      handle: "pure-fan",
      avatar: "P",
      role: "fan",
      creatorStatus: "none",
      walletBalance: { create: { available: 0, pending: 0, currency: "CNY" } }
    }
  });

  for (const creator of creators) {
    await prisma.user.create({
      data: {
        id: creator.id,
        name: creator.name,
        handle: creator.handle,
        avatar: creator.avatar,
        role: "creator",
        creatorStatus: "approved",
        creatorProfile: {
          create: {
            id: `${creator.id}-profile`,
            bio: creator.bio,
            category: creator.category,
            followers: creator.followers,
            members: creator.members,
            cover: creator.cover,
            verified: creator.verified,
            levelId: levelForFollowers(creator.followers),
            plans: {
              create: creator.plans.map((plan) => ({
                id: plan.id,
                name: plan.name,
                price: plan.price,
                color: plan.color,
                benefits: json(plan.benefits)
              }))
            }
          }
        },
        walletBalance: {
          create: creator.id === "c1" ? { available: 8620, pending: 1280, currency: "CNY" } : { available: 0, pending: 0, currency: "CNY" }
        }
      }
    });
  }

  for (const post of posts) {
    await prisma.post.create({
      data: {
        id: post.id,
        creatorId: post.creatorId,
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        cover: post.cover,
        category: post.category,
        tags: json(post.tags),
        visibility: post.visibility,
        contentType: "photo_short",
        saleMode: post.visibility === "purchase" ? "single_plus_subscription" : "subscription_only",
        price: post.price ?? null,
        likes: post.likes,
        comments: json(post.comments),
        createdLabel: post.createdAt,
        media: {
          create: post.media.map((asset) => ({
            id: asset.id,
            src: asset.src,
            alt: asset.alt,
            width: asset.width,
            height: asset.height,
            order: asset.order,
            kind: "image"
          }))
        }
      }
    });
  }

  await prisma.transaction.createMany({
    data: transactions.map((transaction) => ({
      id: transaction.id,
      userId: "c1",
      title: transaction.title,
      amount: transaction.amount,
      type: transaction.type,
      dateLabel: transaction.date,
      status: transaction.status
    }))
  });

  await prisma.follow.createMany({
    data: [
      { userId: "fan-demo", creatorId: "c1" },
      { userId: "fan-demo", creatorId: "c3" }
    ]
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });


