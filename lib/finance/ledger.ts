import { Prisma } from "@prisma/client";
import type { AdminContext } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const DAY_MS = 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;
type EntryInput = {
  key: string;
  type: string;
  ownerUserId?: string;
  amount: number;
};

const creatorAccount = (userId: string, bucket: "pending" | "available" | "reserved" | "debt", currency: string) => ({
  key: `creator:${userId}:${bucket}:${currency}`,
  type: `creator_${bucket}`,
  ownerUserId: userId
});

export async function postLedgerTransaction(tx: Tx, input: {
  idempotencyKey: string;
  type: string;
  referenceType: string;
  referenceId: string;
  currency: string;
  entries: EntryInput[];
  metadata?: unknown;
}) {
  if (!input.entries.length || input.entries.some((entry) => !Number.isInteger(entry.amount))) {
    throw new Error("Ledger entries must contain integer minor-unit amounts.");
  }
  const total = input.entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (total !== 0) throw new Error(`Ledger transaction is unbalanced by ${total}.`);

  const existing = await tx.ledgerTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { entries: { include: { account: true } } }
  });
  if (existing) return existing;

  const accounts: Array<{ id: string }> = [];
  for (const entry of input.entries) {
    accounts.push(await tx.ledgerAccount.upsert({
      where: { key: entry.key },
      update: {},
      create: {
        key: entry.key,
        type: entry.type,
        ownerUserId: entry.ownerUserId,
        currency: input.currency
      }
    }));
  }

  const ledgerTransaction = await tx.ledgerTransaction.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      currency: input.currency,
      metadata: json(input.metadata ?? {}),
      entries: {
        create: input.entries.map((entry, index) => ({
          accountId: accounts[index].id,
          amount: entry.amount
        }))
      }
    },
    include: { entries: { include: { account: true } } }
  });

  for (let index = 0; index < input.entries.length; index += 1) {
    await tx.ledgerAccount.update({
      where: { id: accounts[index].id },
      data: { balance: { increment: input.entries[index].amount } }
    });
  }
  return ledgerTransaction;
}

async function activeSettlementConfig(tx: Tx) {
  return (await tx.settlementConfig.findFirst({
    where: { status: "active" },
    orderBy: { activatedAt: "desc" }
  })) ?? tx.settlementConfig.create({
    data: { id: "settlement-v1", name: "Phase 5 default settlement", holdDays: 7, status: "active", activatedAt: new Date() }
  });
}

export async function recordPaymentLedger(tx: Tx, order: {
  id: string;
  creatorUserId: string;
  amount: number;
  currency: string;
  platformFeeAmount: number;
  creatorNetAmount: number;
  provider: string | null;
}) {
  const config = await activeSettlementConfig(tx);
  const availableAt = new Date(Date.now() + config.holdDays * DAY_MS);
  const pending = creatorAccount(order.creatorUserId, "pending", order.currency);
  const ledger = await postLedgerTransaction(tx, {
    idempotencyKey: `payment:${order.id}`,
    type: "payment_capture",
    referenceType: "order",
    referenceId: order.id,
    currency: order.currency,
    metadata: { provider: order.provider, holdDays: config.holdDays, availableAt: availableAt.toISOString() },
    entries: [
      { key: `provider:${order.provider ?? "manual"}:clearing:${order.currency}`, type: "provider_clearing", amount: -order.amount },
      { key: `platform:revenue:${order.currency}`, type: "platform_revenue", amount: order.platformFeeAmount },
      { ...pending, amount: order.creatorNetAmount }
    ]
  });
  return { ledger, availableAt };
}

export async function settleDueRevenue(now = new Date()) {
  const due = await prisma.paymentTransaction.findMany({
    where: { status: "succeeded", settledAt: null, availableAt: { lte: now } },
    orderBy: { availableAt: "asc" },
    take: 100
  });
  let settled = 0;
  for (const payment of due) {
    const didSettle = await prisma.$transaction(async (tx) => {
      const current = await tx.paymentTransaction.findUnique({ where: { id: payment.id }, include: { order: true } });
      if (!current || current.settledAt || current.status !== "succeeded") return false;
      const pending = creatorAccount(current.order.creatorUserId, "pending", current.currency);
      const available = creatorAccount(current.order.creatorUserId, "available", current.currency);
      await postLedgerTransaction(tx, {
        idempotencyKey: `settlement:${current.id}`,
        type: "creator_settlement",
        referenceType: "payment_transaction",
        referenceId: current.id,
        currency: current.currency,
        entries: [
          { ...pending, amount: -current.creatorNetAmount },
          { ...available, amount: current.creatorNetAmount }
        ]
      });
      await tx.walletBalance.update({
        where: { userId: current.order.creatorUserId },
        data: { pending: { decrement: current.creatorNetAmount }, available: { increment: current.creatorNetAmount } }
      });
      await tx.paymentTransaction.update({ where: { id: current.id }, data: { settledAt: now } });
      return true;
    });
    if (didSettle) settled += 1;
  }
  return { scanned: due.length, settled };
}

export async function reservePayout(tx: Tx, input: { id: string; userId: string; amount: number; currency: string }) {
  const available = creatorAccount(input.userId, "available", input.currency);
  const reserved = creatorAccount(input.userId, "reserved", input.currency);
  return postLedgerTransaction(tx, {
    idempotencyKey: `payout:reserve:${input.id}`,
    type: "payout_reserve",
    referenceType: "payout_request",
    referenceId: input.id,
    currency: input.currency,
    entries: [{ ...available, amount: -input.amount }, { ...reserved, amount: input.amount }]
  });
}

export async function releasePayout(tx: Tx, input: { id: string; userId: string; amount: number; currency: string }) {
  const available = creatorAccount(input.userId, "available", input.currency);
  const reserved = creatorAccount(input.userId, "reserved", input.currency);
  return postLedgerTransaction(tx, {
    idempotencyKey: `payout:release:${input.id}`,
    type: "payout_release",
    referenceType: "payout_request",
    referenceId: input.id,
    currency: input.currency,
    entries: [{ ...reserved, amount: -input.amount }, { ...available, amount: input.amount }]
  });
}

export async function completePayout(tx: Tx, input: { id: string; userId: string; amount: number; currency: string; channel: string }) {
  const reserved = creatorAccount(input.userId, "reserved", input.currency);
  return postLedgerTransaction(tx, {
    idempotencyKey: `payout:paid:${input.id}`,
    type: "payout_paid",
    referenceType: "payout_request",
    referenceId: input.id,
    currency: input.currency,
    metadata: { channel: input.channel },
    entries: [
      { ...reserved, amount: -input.amount },
      { key: `payout:${input.channel}:clearing:${input.currency}`, type: "payout_clearing", amount: input.amount }
    ]
  });
}

export async function refundOrder(admin: AdminContext | null, orderId: string, reason: string, source = "admin") {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.refund.findUnique({ where: { orderId } });
    if (existing) return existing;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { paymentTransactions: true } });
    if (!order || !["paid", "fulfilled"].includes(order.status)) throw new Error("Order is not refundable.");
    const payment = order.paymentTransactions.find((item) => item.status === "succeeded");
    if (!payment) throw new Error("Successful payment transaction not found.");

    const wallet = await tx.walletBalance.findUnique({ where: { userId: order.creatorUserId } });
    if (!wallet) throw new Error("Creator wallet not found.");
    const pendingDebit = payment.settledAt ? 0 : Math.min(wallet.pending, order.creatorNetAmount);
    const availableDebit = Math.min(wallet.available, order.creatorNetAmount - pendingDebit);
    const debtIncrease = order.creatorNetAmount - pendingDebit - availableDebit;
    const entries: EntryInput[] = [
      { key: `provider:${payment.provider}:clearing:${order.currency}`, type: "provider_clearing", amount: order.amount },
      { key: `platform:revenue:${order.currency}`, type: "platform_revenue", amount: -order.platformFeeAmount }
    ];
    if (pendingDebit) entries.push({ ...creatorAccount(order.creatorUserId, "pending", order.currency), amount: -pendingDebit });
    if (availableDebit) entries.push({ ...creatorAccount(order.creatorUserId, "available", order.currency), amount: -availableDebit });
    if (debtIncrease) entries.push({ ...creatorAccount(order.creatorUserId, "debt", order.currency), amount: -debtIncrease });

    const ledger = await postLedgerTransaction(tx, {
      idempotencyKey: `refund:${order.id}`,
      type: source === "chargeback" ? "chargeback" : "refund",
      referenceType: "order",
      referenceId: order.id,
      currency: order.currency,
      metadata: { reason, source },
      entries
    });
    await tx.walletBalance.update({
      where: { userId: order.creatorUserId },
      data: {
        pending: { decrement: pendingDebit },
        available: { decrement: availableDebit },
        debt: { increment: debtIncrease }
      }
    });
    await tx.entitlement.deleteMany({ where: { orderId: order.id } });
    await tx.subscription.updateMany({ where: { orderId: order.id }, data: { status: "refunded" } });
    await tx.paymentTransaction.updateMany({ where: { orderId: order.id }, data: { status: source === "chargeback" ? "charged_back" : "refunded" } });
    await tx.order.update({ where: { id: order.id }, data: { status: source === "chargeback" ? "charged_back" : "refunded" } });
    const refund = await tx.refund.create({
      data: { orderId, reason, source, ledgerTransactionId: ledger.id, createdBy: admin?.actorUserId }
    });
    if (admin) {
      await tx.auditLog.create({
        data: { actorUserId: admin.actorUserId, actorRole: admin.role, action: "finance.order.refund", targetType: "order", targetId: order.id, metadata: json({ reason, source }) }
      });
    }
    return refund;
  });
}

export async function listSettlementConfigs() {
  if (!process.env.DATABASE_URL) return [{ id: "settlement-v1", name: "Phase 5 default settlement", holdDays: 7, status: "active" }];
  return prisma.settlementConfig.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
}

export async function createSettlementConfig(admin: AdminContext, input: { name: string; holdDays: number }) {
  if (!Number.isInteger(input.holdDays) || input.holdDays < 0 || input.holdDays > 90) throw new Error("holdDays must be from 0 to 90.");
  return prisma.settlementConfig.create({ data: { name: input.name, holdDays: input.holdDays } });
}

export async function activateSettlementConfig(admin: AdminContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.settlementConfig.updateMany({ where: { status: "active", id: { not: id } }, data: { status: "archived" } });
    const config = await tx.settlementConfig.update({ where: { id }, data: { status: "active", activatedAt: new Date() } });
    await tx.auditLog.create({
      data: { actorUserId: admin.actorUserId, actorRole: admin.role, action: "finance.settlement.activate", targetType: "settlement_config", targetId: id, metadata: json({ holdDays: config.holdDays }) }
    });
    return config;
  });
}

export async function getKycCase(userId: string) {
  if (!process.env.DATABASE_URL) return { userId, status: "not_submitted" };
  return (await prisma.kycCase.findUnique({
    where: { userId },
    select: { id: true, userId: true, status: true, legalName: true, countryCode: true, reviewNote: true, updatedAt: true }
  })) ?? { userId, status: "not_submitted" };
}

export async function submitKycCase(input: { userId: string; legalName: string; countryCode: string; documentKeys: string[] }) {
  return prisma.kycCase.upsert({
    where: { userId: input.userId },
    update: { legalName: input.legalName, countryCode: input.countryCode, documentKeys: json(input.documentKeys), status: "pending", reviewNote: "", reviewedAt: null, reviewedBy: null },
    create: { ...input, documentKeys: json(input.documentKeys), status: "pending" }
  });
}

export async function listKycCases() {
  return prisma.kycCase.findMany({ include: { user: { select: { id: true, handle: true, name: true } } }, orderBy: { updatedAt: "desc" } });
}

export async function reviewKycCase(admin: AdminContext, input: { id: string; status: "approved" | "rejected"; reviewNote?: string }) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.kycCase.update({
      where: { id: input.id },
      data: { status: input.status, reviewNote: input.reviewNote ?? "", reviewedAt: new Date(), reviewedBy: admin.actorUserId }
    });
    await tx.auditLog.create({
      data: { actorUserId: admin.actorUserId, actorRole: admin.role, action: "finance.kyc.review", targetType: "kyc_case", targetId: item.id, metadata: json({ status: input.status }) }
    });
    return item;
  });
}

export async function runReconciliation() {
  const discrepancies: Array<Record<string, unknown>> = [];
  const grouped = await prisma.ledgerEntry.groupBy({ by: ["transactionId"], _sum: { amount: true } });
  for (const group of grouped) {
    if (group._sum.amount !== 0) discrepancies.push({ type: "unbalanced_ledger", transactionId: group.transactionId, amount: group._sum.amount });
  }
  const payments = await prisma.paymentTransaction.findMany({ where: { status: { in: ["succeeded", "refunded", "charged_back"] } }, include: { order: true } });
  const paymentLedgerKeys = new Set((await prisma.ledgerTransaction.findMany({ where: { type: "payment_capture" }, select: { idempotencyKey: true } })).map((item) => item.idempotencyKey));
  for (const payment of payments) {
    const metadata = payment.metadata as { ledgerMigratedAsOpening?: boolean };
    if (!metadata.ledgerMigratedAsOpening && !paymentLedgerKeys.has(`payment:${payment.orderId}`)) discrepancies.push({ type: "payment_missing_ledger", paymentTransactionId: payment.id, orderId: payment.orderId });
  }
  const wallets = await prisma.walletBalance.findMany();
  const accounts = await prisma.ledgerAccount.findMany({ where: { ownerUserId: { not: null } } });
  for (const wallet of wallets) {
    const own = accounts.filter((account) => account.ownerUserId === wallet.userId && account.currency === wallet.currency);
    const value = (type: string) => own.filter((account) => account.type === type).reduce((sum, account) => sum + account.balance, 0);
    const actual = { pending: value("creator_pending"), available: value("creator_available"), reserved: value("creator_reserved"), debt: Math.max(0, -value("creator_debt")) };
    if (wallet.pending !== actual.pending || wallet.available !== actual.available || wallet.reserved !== actual.reserved || wallet.debt !== actual.debt) {
      discrepancies.push({ type: "wallet_cache_mismatch", userId: wallet.userId, cached: { pending: wallet.pending, available: wallet.available, reserved: wallet.reserved, debt: wallet.debt }, ledger: actual });
    }
  }
  return prisma.reconciliationRun.create({
    data: {
      paymentCount: payments.length,
      ledgerCount: grouped.length,
      walletCount: wallets.length,
      discrepancyCount: discrepancies.length,
      discrepancies: json(discrepancies),
      completedAt: new Date()
    }
  });
}

export async function listReconciliationRuns() {
  return prisma.reconciliationRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
}

export async function listLedgerTransactions(referenceId?: string) {
  return prisma.ledgerTransaction.findMany({
    where: referenceId ? { referenceId } : undefined,
    include: { entries: { include: { account: { select: { key: true, type: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}
