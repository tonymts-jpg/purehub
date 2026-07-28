import { Prisma, PrismaClient } from "@prisma/client";
import { creators, posts, transactions } from "../lib/data";
import { hashPassword } from "better-auth/crypto";

const prisma = new PrismaClient();
const json = (value: unknown) => value as Prisma.InputJsonValue;

type SeededCreatorLevelId = "level-1" | "level-2" | "level-3";

const seededCreatorLevelOverrides: Readonly<Partial<Record<string, SeededCreatorLevelId>>> = Object.freeze({
  c1: "level-2"
});

const levelForFollowers = (followers: number): SeededCreatorLevelId => {
  if (followers >= 100_000) return "level-3";
  if (followers >= 50_000) return "level-2";
  return "level-1";
};

async function main() {
  await prisma.$transaction([
    prisma.searchDocument.deleteMany(),
    prisma.channelJob.deleteMany(),
    prisma.channelInvitation.deleteMany(),
    prisma.channelPostExclusion.deleteMany(),
    prisma.channelPost.deleteMany(),
    prisma.channelRule.deleteMany(),
    prisma.channelMembership.deleteMany(),
    prisma.channelQuotaOverride.deleteMany(),
    prisma.channel.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.postComment.deleteMany(),
    prisma.postLike.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.verification.deleteMany(),
    prisma.ledgerEntry.deleteMany(),
    prisma.ledgerTransaction.deleteMany(),
    prisma.ledgerAccount.deleteMany(),
    prisma.reconciliationRun.deleteMany(),
    prisma.refund.deleteMany(),
    prisma.kycCase.deleteMany(),
    prisma.settlementConfig.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.adminAccount.deleteMany(),
    prisma.paymentTransaction.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.paymentIntent.deleteMany(),
    prisma.order.deleteMany(),
    prisma.platformFeeConfig.deleteMany(),
    prisma.paymentChannelConfig.deleteMany(),
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
    prisma.pricingVersion.deleteMany(),
    prisma.creatorLevel.deleteMany()
  ]);

  await prisma.creatorLevel.createMany({
    data: [
      { id: "level-1", name: "Starter", minFollowers: 0, maxFollowers: 49_999 },
      { id: "level-2", name: "Rising", minFollowers: 50_000, maxFollowers: 99_999 },
      { id: "level-3", name: "Premium", minFollowers: 100_000, maxFollowers: null }
    ]
  });

  await prisma.pricingVersion.create({
    data: {
      id: "pricing-v1",
      name: "Phase 3 active baseline pricing",
      status: "active",
      publishedAt: new Date()
    }
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
        pricingVersionId: "pricing-v1",
        contentType,
        saleMode,
        price,
        currency: "CNY",
        active: true
      }))
    )
  });

  await prisma.paymentChannelConfig.createMany({
    data: [
      {
        id: "pay-stripe",
        provider: "stripe",
        enabled: false,
        mode: "test",
        currencies: json(["CNY", "USD"]),
        regions: json(["global"]),
        feeNote: "Configured in Phase 4 before real payments.",
        config: json({}),
        statusNote: "not_configured"
      },
      {
        id: "pay-paypal",
        provider: "paypal",
        enabled: false,
        mode: "test",
        currencies: json(["USD"]),
        regions: json(["global"]),
        feeNote: "Sandbox only until Phase 4 payment adapter is enabled.",
        config: json({}),
        statusNote: "not_configured"
      },
      {
        id: "pay-card",
        provider: "card",
        enabled: true,
        mode: "test",
        currencies: json(["CNY", "USD"]),
        regions: json(["global"]),
        feeNote: "Phase 4 test card uses manual confirmation and never collects real card data.",
        config: json({ adapter: "manual_confirm", instructions: "Use the Phase 4 manual confirm endpoint for sandbox payments." }),
        statusNote: "manual_confirm_enabled"
      },
      {
        id: "pay-alipay-intl",
        provider: "alipay_intl",
        enabled: false,
        mode: "test",
        currencies: json(["CNY", "USD"]),
        regions: json(["CN", "global"]),
        feeNote: "International merchant eligibility must be confirmed.",
        config: json({}),
        statusNote: "not_configured"
      },
      {
        id: "pay-wechatpay-intl",
        provider: "wechatpay_intl",
        enabled: false,
        mode: "test",
        currencies: json(["CNY", "USD"]),
        regions: json(["CN", "global"]),
        feeNote: "International merchant eligibility must be confirmed.",
        config: json({}),
        statusNote: "not_configured"
      },
      {
        id: "pay-usdt",
        provider: "usdt",
        enabled: false,
        mode: "test",
        currencies: json(["USDT"]),
        regions: json(["global"]),
        feeNote: "TRC20 and ERC20 are default staging options.",
        config: json({ networks: ["TRC20", "ERC20"], minConfirmations: 12, orderTtlMinutes: 30, rateSource: "admin_fixed_rate" }),
        statusNote: "not_configured"
      }
    ]
  });

  await prisma.platformFeeConfig.create({
    data: {
      id: "platform-fee-v1",
      name: "Phase 4 default platform fee",
      feeBps: 1000,
      status: "active",
      activatedAt: new Date()
    }
  });

  await prisma.settlementConfig.create({
    data: {
      id: "settlement-v1",
      name: "Phase 5 default settlement",
      holdDays: 7,
      status: "active",
      activatedAt: new Date()
    }
  });

  await prisma.user.create({
    data: {
      id: "fan-demo",
      name: "Pure 粉丝",
      handle: "pure-fan",
      email: "fan@purehub.local",
      avatar: "P",
      role: "fan",
      creatorStatus: "none",
      walletBalance: { create: { available: 0, pending: 0, currency: "CNY" } }
    }
  });

  await prisma.user.create({
    data: {
      id: "admin-demo",
      name: "PureHub Admin",
      handle: "purehub-admin",
      email: "admin@purehub.local",
      avatar: "A",
      role: "admin",
      creatorStatus: "none",
      adminAccounts: {
        create: {
          role: "super_admin",
          status: "active"
        }
      },
      walletBalance: { create: { available: 0, pending: 0, currency: "CNY" } }
    }
  });

  await prisma.user.create({
    data: {
      id: "support-demo",
      name: "PureHub Support",
      handle: "purehub-support",
      email: "support@purehub.local",
      avatar: "S",
      role: "admin",
      creatorStatus: "none",
      adminAccounts: { create: { role: "support_admin", status: "active" } },
      walletBalance: { create: { available: 0, pending: 0, currency: "CNY" } }
    }
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: "admin-demo",
      actorRole: "super_admin",
      action: "seed.phase3",
      targetType: "system",
      targetId: "phase-3",
      metadata: json({ note: "Phase 3 admin baseline seeded" })
    }
  });

  for (const creator of creators) {
    await prisma.user.create({
      data: {
        id: creator.id,
        name: creator.name,
        handle: creator.handle,
        email: `${creator.handle}@purehub.local`,
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
            levelId: seededCreatorLevelOverrides[creator.id] ?? levelForFollowers(creator.followers),
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

  const demoPassword = process.env.DEMO_ACCOUNT_PASSWORD ?? (process.env.NODE_ENV === "production" ? "" : "PureHubDemo!2026");
  if (!demoPassword) throw new Error("DEMO_ACCOUNT_PASSWORD is required when seeding production-like environments.");
  const password = await hashPassword(demoPassword);
  await prisma.account.createMany({
    data: ["fan-demo", "admin-demo", "support-demo", ...creators.map((creator) => creator.id)].map((userId) => ({
      id: `credential-${userId}`,
      accountId: userId,
      providerId: "credential",
      userId,
      password
    }))
  });

  await prisma.kycCase.create({
    data: {
      id: "kyc-c1-approved",
      userId: "c1",
      status: "approved",
      legalName: "Phase 5 Demo Creator",
      countryCode: "CN",
      documentKeys: json(["kyc/c1/demo-document.enc"]),
      reviewNote: "Seeded approval for staging payout tests.",
      reviewedAt: new Date(),
      reviewedBy: "admin-demo"
    }
  });

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
            kind: asset.kind === "video" ? "video" : "image"
          }))
        }
      }
    });
  }

  await prisma.postComment.createMany({
    data: posts.map((post, index) => ({
      id: `seed-comment-${post.id}`,
      postId: post.id,
      authorId: "fan-demo",
      content: post.comments[0]?.text ?? "期待看到更多创作。",
      status: "visible",
      createdAt: new Date(Date.UTC(2026, 6, 1, 0, index))
    }))
  });

  const phase7SeededAt = new Date("2026-07-24T00:00:00.000Z");
  await prisma.channel.createMany({
    data: [
      {
        id: "channel-purehub-official",
        slug: "purehub-official",
        name: "PureHub Official",
        description: "Platform announcements and featured public releases from PureHub.",
        kind: "official",
        visibility: "public",
        discoverability: "discoverable",
        status: "active",
        ownerUserId: "admin-demo",
        createdByUserId: "admin-demo",
        memberPostPolicy: "approval_required",
        reviewedByAdminId: "admin-demo",
        reviewedAt: phase7SeededAt
      },
      {
        id: "channel-yuki-studio",
        slug: "yuki-studio",
        name: "Yuki Studio",
        description: "Public Cosplay curation from Yuki Studio.",
        kind: "creator",
        visibility: "public",
        discoverability: "discoverable",
        status: "active",
        ownerUserId: "c1",
        createdByUserId: "c1",
        memberPostPolicy: "direct",
        reviewedByAdminId: "admin-demo",
        reviewedAt: phase7SeededAt
      },
      {
        id: "channel-private-curators",
        slug: "private-curators",
        name: "Private Curators",
        description: "A discoverable private channel for collaborative curation.",
        kind: "creator",
        visibility: "private",
        discoverability: "discoverable",
        status: "active",
        ownerUserId: "c2",
        createdByUserId: "c2",
        memberPostPolicy: "approval_required",
        reviewedByAdminId: "admin-demo",
        reviewedAt: phase7SeededAt
      }
    ]
  });

  await prisma.channelMembership.createMany({
    data: [
      { id: "membership-official-owner", channelId: "channel-purehub-official", userId: "admin-demo", role: "owner", status: "active", reviewedByUserId: "admin-demo", reviewedAt: phase7SeededAt },
      { id: "membership-yuki-owner", channelId: "channel-yuki-studio", userId: "c1", role: "owner", status: "active", reviewedByUserId: "admin-demo", reviewedAt: phase7SeededAt },
      { id: "membership-curators-owner", channelId: "channel-private-curators", userId: "c2", role: "owner", status: "active", reviewedByUserId: "admin-demo", reviewedAt: phase7SeededAt },
      { id: "membership-curators-editor", channelId: "channel-private-curators", userId: "c1", role: "editor", status: "active", invitedByUserId: "c2", reviewedByUserId: "c2", reviewedAt: phase7SeededAt },
      { id: "membership-curators-member", channelId: "channel-private-curators", userId: "fan-demo", role: "member", status: "active", invitedByUserId: "c2", reviewedByUserId: "c2", reviewedAt: phase7SeededAt }
    ]
  });

  await prisma.channelRule.create({
    data: {
      id: "rule-yuki-cosplay",
      channelId: "channel-yuki-studio",
      kind: "category",
      value: "Cosplay",
      enabled: true,
      createdByUserId: "c1"
    }
  });

  await prisma.channelPost.create({
    data: {
      id: "channel-post-curators-manual",
      channelId: "channel-private-curators",
      postId: "post-2",
      source: "manual",
      status: "active",
      position: 1,
      pinnedAt: phase7SeededAt,
      addedByUserId: "c2",
      reviewedByUserId: "c2"
    }
  });

  await prisma.channelPostExclusion.create({
    data: {
      id: "exclusion-yuki-post-6",
      channelId: "channel-yuki-studio",
      postId: "post-6",
      excludedByUserId: "c1",
      reason: "Seeded example showing that manual exclusions override category-rule inclusion."
    }
  });

  await prisma.searchDocument.createMany({
    data: [
      ...posts
        .filter((post) => post.visibility === "free")
        .map((post) => ({
          id: `search-post-${post.id}`,
          entityType: "post",
          entityId: post.id,
          title: post.title,
          body: `${post.excerpt} ${post.content}`,
          keywords: [post.category, ...post.tags].join(" "),
          popularityScore: post.likes,
          publishedAt: phase7SeededAt
        })),
      ...creators.map((creator) => ({
        id: `search-creator-${creator.id}`,
        entityType: "creator",
        entityId: creator.id,
        title: creator.name,
        body: creator.bio,
        keywords: `${creator.handle} ${creator.category}`,
        popularityScore: creator.followers,
        publishedAt: phase7SeededAt
      })),
      {
        id: "search-channel-purehub-official",
        entityType: "channel",
        entityId: "channel-purehub-official",
        title: "PureHub Official",
        body: "Platform announcements and featured public releases from PureHub.",
        keywords: "purehub-official official public",
        popularityScore: 0,
        publishedAt: phase7SeededAt
      },
      {
        id: "search-channel-yuki-studio",
        entityType: "channel",
        entityId: "channel-yuki-studio",
        title: "Yuki Studio",
        body: "Public Cosplay curation from Yuki Studio.",
        keywords: "yuki-studio creator public Cosplay",
        popularityScore: 0,
        publishedAt: phase7SeededAt
      },
      {
        id: "search-channel-private-curators",
        entityType: "channel",
        entityId: "channel-private-curators",
        title: "Private Curators",
        body: "A discoverable private channel for collaborative curation.",
        keywords: "private-curators creator private discoverable",
        popularityScore: 0,
        publishedAt: phase7SeededAt
      }
    ]
  });

  const openingAccounts = await Promise.all([
    prisma.ledgerAccount.create({ data: { key: "creator:c1:available:CNY", ownerUserId: "c1", type: "creator_available", currency: "CNY", balance: 8620 } }),
    prisma.ledgerAccount.create({ data: { key: "creator:c1:pending:CNY", ownerUserId: "c1", type: "creator_pending", currency: "CNY", balance: 1280 } }),
    prisma.ledgerAccount.create({ data: { key: "platform:opening_equity:CNY", type: "opening_equity", currency: "CNY", balance: -9900 } })
  ]);
  await prisma.ledgerTransaction.create({
    data: {
      idempotencyKey: "seed:phase5:opening-balances",
      type: "opening_balance",
      referenceType: "seed",
      referenceId: "phase-5",
      currency: "CNY",
      metadata: json({ note: "Balances migrated into the Phase 5 ledger" }),
      entries: {
        create: openingAccounts.map((account) => ({ accountId: account.id, amount: account.balance }))
      }
    }
  });

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
