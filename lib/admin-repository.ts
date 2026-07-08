import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { creators, posts, transactions } from "./data";
import type { AdminContext } from "./admin-auth";
import type { ContentType, PaymentProvider, SaleMode } from "./platform-config";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const canUseDatabase = () => Boolean(process.env.DATABASE_URL);

const fallbackLevels = [
  { id: "level-1", name: "Starter", minFollowers: 0, maxFollowers: 49_999, _count: { creators: 0 } },
  { id: "level-2", name: "Rising", minFollowers: 50_000, maxFollowers: 99_999, _count: { creators: 0 } },
  { id: "level-3", name: "Premium", minFollowers: 100_000, maxFollowers: null, _count: { creators: 0 } }
];

const fallbackTiers = [
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

const fallbackPricingVersion = {
  id: "pricing-v1",
  name: "Phase 3 active baseline pricing",
  status: "active",
  tiers: fallbackTiers.flatMap(([levelId, contentType, saleMode, prices]) =>
    prices.map((price) => ({
      id: `pricing-v1-${levelId}-${contentType}-${saleMode}-${price}`,
      levelId,
      pricingVersionId: "pricing-v1",
      contentType,
      saleMode,
      price,
      currency: "CNY",
      active: true
    }))
  )
};

const fallbackPaymentChannels = [
  { provider: "alipay_intl", enabled: false, mode: "test", currencies: ["CNY", "USD"], regions: ["CN", "global"], feeNote: "International merchant eligibility must be confirmed.", statusNote: "not_configured", config: {} },
  { provider: "card", enabled: false, mode: "test", currencies: ["CNY", "USD"], regions: ["global"], feeNote: "Card routing follows the selected provider in Phase 4.", statusNote: "not_configured", config: {} },
  { provider: "paypal", enabled: false, mode: "test", currencies: ["USD"], regions: ["global"], feeNote: "Sandbox only until Phase 4 payment adapter is enabled.", statusNote: "not_configured", config: {} },
  { provider: "stripe", enabled: false, mode: "test", currencies: ["CNY", "USD"], regions: ["global"], feeNote: "Configured in Phase 4 before real payments.", statusNote: "not_configured", config: {} },
  { provider: "usdt", enabled: false, mode: "test", currencies: ["USDT"], regions: ["global"], feeNote: "TRC20 and ERC20 are default staging options.", statusNote: "not_configured", config: { networks: ["TRC20", "ERC20"], minConfirmations: 12, orderTtlMinutes: 30, rateSource: "admin_fixed_rate" } },
  { provider: "wechatpay_intl", enabled: false, mode: "test", currencies: ["CNY", "USD"], regions: ["CN", "global"], feeNote: "International merchant eligibility must be confirmed.", statusNote: "not_configured", config: {} }
];

const fallbackAuditLogs = [
  { id: "audit-demo", actorUserId: "admin-demo", actorRole: "super_admin", action: "seed.phase3", targetType: "system", targetId: "phase-3", metadata: { note: "Phase 3 admin fallback" }, createdAt: new Date().toISOString() }
];

export async function writeAuditLog(admin: AdminContext, action: string, targetType: string, targetId: string, metadata: unknown = {}) {
  if (!canUseDatabase()) {
    return { id: `audit-${Date.now()}`, actorUserId: admin.actorUserId, actorRole: admin.role, action, targetType, targetId, metadata, createdAt: new Date() };
  }

  return prisma.auditLog.create({
    data: {
      actorUserId: admin.actorUserId,
      actorRole: admin.role,
      action,
      targetType,
      targetId,
      metadata: json(metadata)
    }
  });
}

export async function getAdminOverview() {
  if (!canUseDatabase()) {
    return {
      metrics: { users: creators.length + 2, creators: creators.length, pendingApplications: 0, posts: posts.length, transactions: transactions.length, payouts: 0 },
      activePricingVersion: fallbackPricingVersion,
      auditLogs: fallbackAuditLogs
    };
  }

  const [users, creatorCount, pendingApplications, postCount, transactionCount, payouts, activePricingVersion, auditLogs] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "creator" } }),
    prisma.creatorApplication.count({ where: { status: "pending" } }),
    prisma.post.count(),
    prisma.transaction.count(),
    prisma.payoutRequest.count(),
    prisma.pricingVersion.findFirst({ where: { status: "active" }, orderBy: { publishedAt: "desc" } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 })
  ]);

  return {
    metrics: { users, creators: creatorCount, pendingApplications, posts: postCount, transactions: transactionCount, payouts },
    activePricingVersion,
    auditLogs
  };
}

export async function listAdminUsers() {
  if (!canUseDatabase()) {
    return [
      { id: "admin-demo", name: "PureHub Admin", handle: "purehub-admin", role: "admin", creatorStatus: "none", createdAt: new Date(), adminAccounts: [{ role: "super_admin", status: "active" }], creatorProfile: null },
      { id: "fan-demo", name: "Pure 粉丝", handle: "pure-fan", role: "fan", creatorStatus: "none", createdAt: new Date(), adminAccounts: [], creatorProfile: null },
      ...creators.map((creator) => ({
        id: creator.id,
        name: creator.name,
        handle: creator.handle,
        role: "creator",
        creatorStatus: "approved",
        createdAt: new Date(),
        adminAccounts: [],
        creatorProfile: { followers: creator.followers, members: creator.members, levelId: creator.followers >= 100_000 ? "level-3" : creator.followers >= 50_000 ? "level-2" : "level-1" }
      }))
    ];
  }

  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      handle: true,
      role: true,
      creatorStatus: true,
      createdAt: true,
      adminAccounts: { select: { role: true, status: true } },
      creatorProfile: { select: { followers: true, members: true, levelId: true } }
    }
  });
}

export async function updateAdminUser(admin: AdminContext, id: string, input: { role?: string; creatorStatus?: string }) {
  if (!canUseDatabase()) {
    await writeAuditLog(admin, "admin.user.update", "user", id, input);
    return { id, ...input };
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      role: input.role,
      creatorStatus: input.creatorStatus
    }
  });
  await writeAuditLog(admin, "admin.user.update", "user", id, input);
  return user;
}

export async function listCreatorApplications() {
  if (!canUseDatabase()) return [];

  return prisma.creatorApplication.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { user: { select: { id: true, name: true, handle: true, role: true, creatorStatus: true } } }
  });
}

export async function reviewApplicationFromAdmin(admin: AdminContext, id: string, status: "approved" | "rejected") {
  if (!canUseDatabase()) {
    await writeAuditLog(admin, `admin.creator_application.${status}`, "creator_application", id);
    return { id, status };
  }

  const application = await prisma.creatorApplication.update({
    where: { id },
    data: { status, reviewedAt: new Date() }
  });

  await prisma.user.update({
    where: { id: application.userId },
    data: { role: status === "approved" ? "creator" : "fan", creatorStatus: status }
  });

  if (status === "approved") {
    await prisma.creatorProfile.upsert({
      where: { userId: application.userId },
      update: { category: application.category },
      create: {
        id: `${application.userId}-profile`,
        userId: application.userId,
        bio: application.note ?? "Creator profile approved by admin.",
        category: application.category,
        followers: 0,
        members: 0,
        cover: "cover-1",
        verified: false,
        levelId: "level-1"
      }
    });
  }

  await writeAuditLog(admin, `admin.creator_application.${status}`, "creator_application", id, { userId: application.userId });
  return application;
}

export async function listCreatorLevels() {
  if (!canUseDatabase()) return fallbackLevels;

  return prisma.creatorLevel.findMany({
    orderBy: { minFollowers: "asc" },
    include: { _count: { select: { creators: true } } }
  });
}

export async function createCreatorLevel(admin: AdminContext, input: { id: string; name: string; minFollowers: number; maxFollowers?: number | null }) {
  if (!canUseDatabase()) {
    await writeAuditLog(admin, "admin.creator_level.create", "creator_level", input.id, input);
    return { ...input, maxFollowers: input.maxFollowers ?? null };
  }

  const level = await prisma.creatorLevel.create({
    data: {
      id: input.id,
      name: input.name,
      minFollowers: input.minFollowers,
      maxFollowers: input.maxFollowers ?? null
    }
  });
  await writeAuditLog(admin, "admin.creator_level.create", "creator_level", level.id, input);
  return level;
}

export async function updateCreatorLevel(admin: AdminContext, id: string, input: { name?: string; minFollowers?: number; maxFollowers?: number | null }) {
  if (!canUseDatabase()) {
    await writeAuditLog(admin, "admin.creator_level.update", "creator_level", id, input);
    return { id, ...input };
  }

  const level = await prisma.creatorLevel.update({
    where: { id },
    data: {
      name: input.name,
      minFollowers: input.minFollowers,
      maxFollowers: input.maxFollowers
    }
  });
  await writeAuditLog(admin, "admin.creator_level.update", "creator_level", id, input);
  return level;
}

export async function listPricingVersions() {
  if (!canUseDatabase()) return [fallbackPricingVersion];

  return prisma.pricingVersion.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { tiers: { orderBy: [{ levelId: "asc" }, { contentType: "asc" }, { saleMode: "asc" }, { price: "asc" }] } }
  });
}

export async function createPricingVersion(
  admin: AdminContext,
  input: { name: string; copyFromVersionId?: string; tiers?: Array<{ levelId: string; contentType: ContentType; saleMode: SaleMode; price: number; currency?: string }> }
) {
  if (!canUseDatabase()) {
    await writeAuditLog(admin, "admin.pricing_version.create", "pricing_version", `pricing-${Date.now()}`, input);
    return { ...fallbackPricingVersion, id: `pricing-${Date.now()}`, name: input.name, status: "draft" };
  }

  const versionId = `pricing-${Date.now()}`;
  const sourceTiers = input.copyFromVersionId
    ? await prisma.priceTier.findMany({ where: { pricingVersionId: input.copyFromVersionId, active: true } })
    : [];
  const tiers = input.tiers?.length ? input.tiers : sourceTiers;

  const version = await prisma.pricingVersion.create({
    data: {
      id: versionId,
      name: input.name,
      status: "draft",
      tiers: {
        create: tiers.map((tier, index) => ({
          id: `${versionId}-${tier.levelId}-${tier.contentType}-${tier.saleMode}-${tier.price}-${index}`,
          levelId: tier.levelId,
          contentType: tier.contentType,
          saleMode: tier.saleMode,
          price: tier.price,
          currency: tier.currency ?? "CNY",
          active: true
        }))
      }
    },
    include: { tiers: true }
  });

  await writeAuditLog(admin, "admin.pricing_version.create", "pricing_version", version.id, {
    copiedFrom: input.copyFromVersionId ?? null,
    tierCount: version.tiers.length
  });
  return version;
}

export async function publishPricingVersion(admin: AdminContext, id: string) {
  if (!canUseDatabase()) {
    await writeAuditLog(admin, "admin.pricing_version.publish", "pricing_version", id);
    return { ...fallbackPricingVersion, id, status: "active" };
  }

  const version = await prisma.$transaction(async (tx) => {
    await tx.pricingVersion.updateMany({
      where: { status: "active", id: { not: id } },
      data: { status: "archived" }
    });
    return tx.pricingVersion.update({
      where: { id },
      data: { status: "active", publishedAt: new Date() },
      include: { tiers: true }
    });
  });
  await writeAuditLog(admin, "admin.pricing_version.publish", "pricing_version", id, { tierCount: version.tiers.length });
  return version;
}

export async function listPaymentChannels() {
  if (!canUseDatabase()) return fallbackPaymentChannels;

  return prisma.paymentChannelConfig.findMany({ orderBy: { provider: "asc" } });
}

export async function updatePaymentChannel(
  admin: AdminContext,
  provider: PaymentProvider,
  input: { enabled?: boolean; mode?: string; currencies?: string[]; regions?: string[]; feeNote?: string; statusNote?: string; config?: unknown }
) {
  if (!canUseDatabase()) {
    await writeAuditLog(admin, "admin.payment_channel.update", "payment_channel", provider, input);
    return { ...fallbackPaymentChannels.find((channel) => channel.provider === provider), provider, ...input };
  }

  const channel = await prisma.paymentChannelConfig.update({
    where: { provider },
    data: {
      enabled: input.enabled,
      mode: input.mode,
      currencies: input.currencies ? json(input.currencies) : undefined,
      regions: input.regions ? json(input.regions) : undefined,
      feeNote: input.feeNote,
      statusNote: input.statusNote,
      config: input.config === undefined ? undefined : json(input.config)
    }
  });
  await writeAuditLog(admin, "admin.payment_channel.update", "payment_channel", provider, input);
  return channel;
}

export async function listAuditLogs() {
  if (!canUseDatabase()) return fallbackAuditLogs;

  return prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
}
