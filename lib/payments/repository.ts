import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdminContext } from "@/lib/admin-auth";
import { PLATFORM_FEE_RULES, type PaymentProvider } from "@/lib/platform-config";
import { resolvePaymentAdapter } from "./adapters";
import { completePayout, recordPaymentLedger, refundOrder, releasePayout, reservePayout } from "@/lib/finance/ledger";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const canUseDatabase = () => Boolean(process.env.DATABASE_URL);

type OrderKind = "post_unlock" | "subscription";

export const PHASE4_FALLBACK_FEE_CONFIG = {
  id: "platform-fee-v1",
  name: "Phase 4 default platform fee",
  feeBps: PLATFORM_FEE_RULES.defaultFeeBps,
  status: "active",
  activatedAt: new Date().toISOString()
};

function assertFeeBps(feeBps: number) {
  if (!Number.isInteger(feeBps) || feeBps < PLATFORM_FEE_RULES.minFeeBps || feeBps > PLATFORM_FEE_RULES.maxFeeBps) {
    throw new Error(`feeBps must be an integer from ${PLATFORM_FEE_RULES.minFeeBps} to ${PLATFORM_FEE_RULES.maxFeeBps}.`);
  }
}

function feeSnapshot(amount: number, feeBps: number) {
  const platformFeeAmount = Math.floor((amount * feeBps) / 10000);
  return {
    platformFeeBps: feeBps,
    platformFeeAmount,
    creatorNetAmount: amount - platformFeeAmount
  };
}

async function getActiveFeeConfig() {
  const active = await prisma.platformFeeConfig.findFirst({
    where: { status: "active" },
    orderBy: { activatedAt: "desc" }
  });
  if (active) return active;
  return prisma.platformFeeConfig.create({
    data: {
      id: "platform-fee-v1",
      name: "Phase 4 default platform fee",
      feeBps: PLATFORM_FEE_RULES.defaultFeeBps,
      status: "active",
      activatedAt: new Date()
    }
  });
}

export async function listPlatformFeeConfigs() {
  if (!canUseDatabase()) return [PHASE4_FALLBACK_FEE_CONFIG];
  return prisma.platformFeeConfig.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
}

export async function createPlatformFeeConfig(admin: AdminContext, input: { name: string; feeBps: number }) {
  assertFeeBps(input.feeBps);
  if (!canUseDatabase()) {
    return { id: `fee-${Date.now()}`, name: input.name, feeBps: input.feeBps, status: "draft", createdBy: admin.actorUserId };
  }
  return prisma.platformFeeConfig.create({
    data: {
      name: input.name,
      feeBps: input.feeBps,
      status: "draft"
    }
  });
}

export async function activatePlatformFeeConfig(admin: AdminContext, id: string) {
  if (!canUseDatabase()) return { ...PHASE4_FALLBACK_FEE_CONFIG, id, status: "active", activatedBy: admin.actorUserId };
  return prisma.$transaction(async (tx) => {
    await tx.platformFeeConfig.updateMany({
      where: { status: "active", id: { not: id } },
      data: { status: "archived" }
    });
    return tx.platformFeeConfig.update({
      where: { id },
      data: { status: "active", activatedAt: new Date() }
    });
  });
}

export async function createOrder(input: {
  buyerUserId: string;
  kind: OrderKind;
  itemId: string;
  currency?: string;
}) {
  const buyerUserId = input.buyerUserId;
  if (!canUseDatabase()) {
    const amount = input.kind === "subscription" ? 48 : 100;
    const snapshot = feeSnapshot(amount, PHASE4_FALLBACK_FEE_CONFIG.feeBps);
    return {
      id: `order-${Date.now()}`,
      buyerUserId,
      creatorUserId: "c1",
      kind: input.kind,
      itemId: input.itemId,
      amount,
      currency: input.currency ?? "CNY",
      status: "pending",
      ...snapshot
    };
  }

  const feeConfig = await getActiveFeeConfig();
  if (input.kind === "post_unlock") {
    const post = await prisma.post.findUnique({ where: { id: input.itemId } });
    if (!post || !post.price) throw new Error("Post is not purchasable.");
    const snapshot = feeSnapshot(post.price, feeConfig.feeBps);
    return prisma.order.create({
      data: {
        buyerUserId,
        creatorUserId: post.creatorId,
        kind: input.kind,
        itemId: post.id,
        amount: post.price,
        currency: input.currency ?? "CNY",
        ...snapshot,
        metadata: json({ feeConfigId: feeConfig.id, postTitle: post.title })
      }
    });
  }

  const plan = await prisma.membershipPlan.findUnique({
    where: { id: input.itemId },
    include: { creator: true }
  });
  if (!plan) throw new Error("Membership plan not found.");
  const snapshot = feeSnapshot(plan.price, feeConfig.feeBps);
  return prisma.order.create({
    data: {
      buyerUserId,
      creatorUserId: plan.creator.userId,
      kind: input.kind,
      itemId: plan.id,
      amount: plan.price,
      currency: input.currency ?? "CNY",
      ...snapshot,
      metadata: json({ feeConfigId: feeConfig.id, planName: plan.name })
    }
  });
}

export async function getOrder(id: string) {
  if (!canUseDatabase()) return null;
  return prisma.order.findUnique({
    where: { id },
    include: {
      paymentIntents: { orderBy: { createdAt: "desc" } },
      paymentTransactions: { orderBy: { createdAt: "desc" } },
      subscriptions: true,
      entitlements: true
    }
  });
}

export async function createPaymentIntent(input: { orderId: string; provider: PaymentProvider; buyerUserId: string }) {
  if (!canUseDatabase()) {
    return {
      id: `intent-${Date.now()}`,
      orderId: input.orderId,
      provider: input.provider,
      status: "requires_confirmation",
      manualInstructions: { message: "Fallback manual confirmation enabled." }
    };
  }

  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error("Order not found.");
  if (order.buyerUserId !== input.buyerUserId) throw new Error("Order does not belong to the signed-in user.");
  if (order.status !== "pending") throw new Error("Order is not pending.");

  const channel = await prisma.paymentChannelConfig.findUnique({ where: { provider: input.provider } });
  if (!channel?.enabled) throw new Error("Payment channel is not enabled.");

  const adapter = resolvePaymentAdapter(input.provider, channel.config);
  const adapterIntent = adapter.createIntent(order, channel);
  return prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { provider: input.provider }
    });
    return tx.paymentIntent.create({
      data: {
        orderId: order.id,
        provider: input.provider,
        amount: order.amount,
        currency: order.currency,
        providerIntentId: adapterIntent.providerIntentId,
        clientSecret: adapterIntent.clientSecret,
        manualInstructions: json(adapterIntent.manualInstructions ?? {}),
        metadata: json(adapterIntent.metadata ?? {})
      }
    });
  });
}

async function fulfillPaidOrder(tx: Prisma.TransactionClient, orderId: string, paymentIntentId: string | null, provider: string, metadata: unknown) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Order not found.");
  if (order.status === "fulfilled") return order;

  const claimed = await tx.order.updateMany({
    where: { id: order.id, status: "pending" },
    data: { status: "paid", paidAt: order.paidAt ?? new Date() }
  });
  if (claimed.count === 0) {
    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  const now = new Date();
  const { availableAt } = await recordPaymentLedger(tx, { ...order, provider });
  await tx.paymentTransaction.create({
    data: {
      orderId: order.id,
      paymentIntentId,
      provider,
      amount: order.amount,
      currency: order.currency,
      status: "succeeded",
      platformFeeBps: order.platformFeeBps,
      platformFeeAmount: order.platformFeeAmount,
      creatorNetAmount: order.creatorNetAmount,
      availableAt,
      metadata: json(metadata ?? {})
    }
  });

  if (order.kind === "post_unlock") {
    await tx.entitlement.upsert({
      where: { userId_postId_source: { userId: order.buyerUserId, postId: order.itemId, source: "purchase" } },
      update: { orderId: order.id },
      create: {
        id: `ent-${order.id}`,
        userId: order.buyerUserId,
        postId: order.itemId,
        orderId: order.id,
        source: "purchase"
      }
    });
  } else {
    await tx.subscription.create({
      data: {
        id: `sub-${order.id}`,
        userId: order.buyerUserId,
        creatorId: order.creatorUserId,
        planId: order.itemId,
        orderId: order.id,
        status: "active"
      }
    });
  }

  await tx.transaction.createMany({
    data: [
      {
        id: `txn-fan-${order.id}`,
        userId: order.buyerUserId,
        orderId: order.id,
        title: order.kind === "subscription" ? "会员订阅" : "购买数字内容",
        amount: -order.amount,
        type: "payout",
        dateLabel: "刚刚",
        status: "支付成功",
        metadata: json({ provider, orderId: order.id })
      },
      {
        id: `txn-creator-${order.id}`,
        userId: order.creatorUserId,
        orderId: order.id,
        title: order.kind === "subscription" ? "会员订阅收入" : "内容销售收入",
        amount: order.creatorNetAmount,
        type: "income",
        dateLabel: "刚刚",
        status: "待结算",
        metadata: json({
          provider,
          orderId: order.id,
          platformFeeBps: order.platformFeeBps,
          platformFeeAmount: order.platformFeeAmount
        })
      }
    ]
  });

  await tx.walletBalance.upsert({
    where: { userId: order.creatorUserId },
    update: { pending: { increment: order.creatorNetAmount } },
    create: {
      userId: order.creatorUserId,
      pending: order.creatorNetAmount,
      available: 0,
      currency: order.currency
    }
  });

  if (order.creatorUserId !== order.buyerUserId) {
    await tx.notification.upsert({
      where: { eventKey: `${order.kind}:${order.id}` },
      update: {},
      create: {
        recipientUserId: order.creatorUserId,
        actorUserId: order.buyerUserId,
        type: order.kind === "subscription" ? "subscription" : "purchase",
        eventKey: `${order.kind}:${order.id}`,
        orderId: order.id,
        postId: order.kind === "post_unlock" ? order.itemId : null
      }
    });
  }

  return tx.order.update({
    where: { id: order.id },
    data: { status: "fulfilled", fulfilledAt: now }
  });
}

export async function confirmPaymentIntent(id: string, buyerUserId: string, payload?: unknown) {
  if (!canUseDatabase()) return { id, status: "succeeded", order: { status: "fulfilled" } };

  const intent = await prisma.paymentIntent.findUnique({ where: { id }, include: { order: true } });
  if (!intent) throw new Error("Payment intent not found.");
  if (intent.order.buyerUserId !== buyerUserId) throw new Error("Payment intent does not belong to the signed-in user.");
  const channel = await prisma.paymentChannelConfig.findUnique({ where: { provider: intent.provider } });
  const adapter = resolvePaymentAdapter(intent.provider as PaymentProvider, channel?.config);
  if (!adapter.supportsManualConfirmation) throw new Error("Provider does not support manual confirmation.");
  const result = adapter.confirmIntent(intent, payload);
  if (result.status !== "succeeded") {
    return prisma.paymentIntent.update({ where: { id }, data: { status: result.status, metadata: json(result.metadata ?? {}) } });
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.paymentIntent.findUnique({ where: { id } });
    if (!current) throw new Error("Payment intent not found.");
    if (current.status !== "succeeded") {
      await tx.paymentIntent.update({
        where: { id },
        data: { status: "succeeded", confirmedAt: new Date(), metadata: json(result.metadata ?? {}) }
      });
    }
    await fulfillPaidOrder(tx, current.orderId, current.id, current.provider, result.metadata);
    return tx.paymentIntent.findUnique({ where: { id }, include: { order: true } });
  });
}

export async function recordWebhook(provider: PaymentProvider, payload: unknown) {
  if (!canUseDatabase()) return { status: "received" };
  const channel = await prisma.paymentChannelConfig.findUnique({ where: { provider } });
  const adapter = resolvePaymentAdapter(provider, channel?.config);
  const parsed = adapter.parseWebhook(payload);

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.webhookEvent.upsert({
      where: { provider_providerEventId: { provider, providerEventId: parsed.providerEventId } },
      update: {},
      create: {
        provider,
        providerEventId: parsed.providerEventId,
        eventType: parsed.eventType,
        payload: json(payload)
      }
    });
    if (event.status === "processed") return { event, orderId: null, status: "processed" };
    if (!parsed.intentId || !["succeeded", "charged_back"].includes(parsed.status)) {
      return { event, orderId: null, status: parsed.status };
    }

    const existingIntent = await tx.paymentIntent.findUnique({ where: { id: parsed.intentId } });
    if (!existingIntent) throw new Error("Payment intent not found.");
    if (parsed.status === "charged_back") {
      return { event, orderId: existingIntent.orderId, status: parsed.status };
    }

    const intent = await tx.paymentIntent.update({
      where: { id: parsed.intentId },
      data: { status: "succeeded", confirmedAt: new Date() }
    });
    await fulfillPaidOrder(tx, intent.orderId, intent.id, provider, { webhookEventId: event.id });
    const processed = await tx.webhookEvent.update({
      where: { id: event.id },
      data: { status: "processed", processedAt: new Date() }
    });
    return { event: processed, orderId: intent.orderId, status: parsed.status };
  });
  if (result.status === "charged_back" && result.orderId) {
    await refundOrder(null, result.orderId, "Provider chargeback", "chargeback");
    return prisma.webhookEvent.update({ where: { id: result.event.id }, data: { status: "processed", processedAt: new Date() } });
  }
  return result.event;
}

export async function listFinanceTransactions() {
  if (!canUseDatabase()) return [];
  return prisma.paymentTransaction.findMany({
    orderBy: { createdAt: "desc" },
    include: { order: true },
    take: 100
  });
}

export async function createPayoutRequest(input: { userId?: string; amount: number; channel: string }) {
  const userId = input.userId ?? "c1";
  if (!Number.isInteger(input.amount) || input.amount < 100) throw new Error("Payout amount must be at least 100.");
  if (!canUseDatabase()) return { id: `payout-${Date.now()}`, userId, amount: input.amount, channel: input.channel, status: "pending" };

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.walletBalance.findUnique({ where: { userId } });
    if (!wallet || wallet.available < input.amount) throw new Error("Available wallet balance is insufficient.");
    if (wallet.debt > 0) throw new Error("Outstanding creator debt must be cleared before payout.");
    const kyc = await tx.kycCase.findUnique({ where: { userId } });
    if (kyc?.status !== "approved") throw new Error("Approved KYC is required before payout.");
    const request = await tx.payoutRequest.create({ data: { userId, amount: input.amount, channel: input.channel, status: "pending" } });
    const ledger = await reservePayout(tx, { id: request.id, userId, amount: input.amount, currency: wallet.currency });
    await tx.walletBalance.update({
      where: { userId },
      data: { available: { decrement: input.amount }, reserved: { increment: input.amount } }
    });
    return tx.payoutRequest.update({ where: { id: request.id }, data: { ledgerTransactionId: ledger.id } });
  });
}

export async function listPayoutRequests() {
  if (!canUseDatabase()) return [];
  return prisma.payoutRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, handle: true } } },
    take: 100
  });
}

export async function reviewPayoutRequest(admin: AdminContext, input: { id: string; status: "approved" | "rejected" | "paid"; reviewNote?: string }) {
  if (!canUseDatabase()) return { id: input.id, status: input.status, reviewedBy: admin.actorUserId };

  return prisma.$transaction(async (tx) => {
    const request = await tx.payoutRequest.findUnique({ where: { id: input.id } });
    if (!request) throw new Error("Payout request not found.");
    if (input.status === "paid" && request.status !== "approved") throw new Error("Only approved payouts can be marked paid.");
    if (input.status !== "paid" && request.status !== "pending") throw new Error("Payout request is already reviewed.");
    const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId: request.userId } });

    if (input.status === "paid") {
      await completePayout(tx, { id: request.id, userId: request.userId, amount: request.amount, currency: wallet.currency, channel: request.channel });
      await tx.walletBalance.update({ where: { userId: request.userId }, data: { reserved: { decrement: request.amount } } });
      await tx.transaction.create({
        data: {
          id: `txn-payout-${request.id}`,
          userId: request.userId,
          title: "创作者提现",
          amount: -request.amount,
          type: "payout",
          dateLabel: "刚刚",
          status: "提现已批准",
          metadata: json({ payoutRequestId: request.id, channel: request.channel })
        }
      });
    }

    if (input.status === "rejected") {
      await releasePayout(tx, { id: request.id, userId: request.userId, amount: request.amount, currency: wallet.currency });
      await tx.walletBalance.update({
        where: { userId: request.userId },
        data: { available: { increment: request.amount }, reserved: { decrement: request.amount } }
      });
    }

    return tx.payoutRequest.update({
      where: { id: request.id },
      data: {
        status: input.status,
        reviewNote: input.reviewNote ?? "",
        reviewedAt: new Date(),
        reviewedBy: admin.actorUserId
      }
    });
  });
}
