-- Phase 4 payments, platform fee configuration, wallet settlement, and payout review.

ALTER TABLE "Subscription" ADD COLUMN "orderId" TEXT;
ALTER TABLE "Entitlement" ADD COLUMN "orderId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "orderId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "PayoutRequest" ADD COLUMN "reviewNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PayoutRequest" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "PayoutRequest" ADD COLUMN "reviewedBy" TEXT;

CREATE TABLE "PlatformFeeConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformFeeConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "platformFeeBps" INTEGER NOT NULL DEFAULT 0,
    "platformFeeAmount" INTEGER NOT NULL DEFAULT 0,
    "creatorNetAmount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "paidAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requires_confirmation',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "providerIntentId" TEXT,
    "clientSecret" TEXT,
    "manualInstructions" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "provider" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" TEXT NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "platformFeeAmount" INTEGER NOT NULL,
    "creatorNetAmount" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
