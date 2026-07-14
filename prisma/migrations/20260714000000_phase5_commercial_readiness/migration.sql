-- Phase 5 commercial readiness: balanced ledger, settlement, refunds, KYC, and private media.
ALTER TABLE "MediaAsset" ALTER COLUMN "postId" DROP NOT NULL;
ALTER TABLE "MediaAsset" ALTER COLUMN "src" SET DEFAULT '';
ALTER TABLE "MediaAsset" ADD COLUMN "uploaderUserId" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE "MediaAsset" ADD COLUMN "sizeBytes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MediaAsset" ADD COLUMN "checksum" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "derivativeKey" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "MediaAsset" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "MediaAsset" ADD COLUMN "processingError" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MediaAsset" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
ALTER TABLE "WalletBalance" ADD COLUMN "reserved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WalletBalance" ADD COLUMN "debt" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayoutRequest" ADD COLUMN "ledgerTransactionId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "availableAt" TIMESTAMP(3);
ALTER TABLE "PaymentTransaction" ADD COLUMN "settledAt" TIMESTAMP(3);
UPDATE "PaymentTransaction"
SET "availableAt" = "createdAt" + INTERVAL '7 days', "metadata" = "metadata" || '{"ledgerMigratedAsOpening":true}'::jsonb
WHERE "status" = 'succeeded';

CREATE TABLE "LedgerAccount" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "ownerUserId" TEXT, "type" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY', "balance" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerAccount_key_key" ON "LedgerAccount"("key");
CREATE TABLE "LedgerTransaction" (
  "id" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "type" TEXT NOT NULL,
  "referenceType" TEXT NOT NULL, "referenceId" TEXT NOT NULL, "currency" TEXT NOT NULL DEFAULT 'CNY',
  "status" TEXT NOT NULL DEFAULT 'posted', "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");
CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL, "transactionId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SettlementConfig" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "holdDays" INTEGER NOT NULL DEFAULT 7,
  "status" TEXT NOT NULL DEFAULT 'draft', "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Refund" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'succeeded', "source" TEXT NOT NULL DEFAULT 'admin',
  "ledgerTransactionId" TEXT, "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Refund_orderId_key" ON "Refund"("orderId");
CREATE TABLE "KycCase" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "legalName" TEXT NOT NULL, "countryCode" TEXT NOT NULL, "documentKeys" JSONB NOT NULL,
  "reviewNote" TEXT NOT NULL DEFAULT '', "reviewedAt" TIMESTAMP(3), "reviewedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KycCase_userId_key" ON "KycCase"("userId");
ALTER TABLE "KycCase" ADD CONSTRAINT "KycCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "ReconciliationRun" (
  "id" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'completed', "paymentCount" INTEGER NOT NULL DEFAULT 0,
  "ledgerCount" INTEGER NOT NULL DEFAULT 0, "walletCount" INTEGER NOT NULL DEFAULT 0,
  "discrepancyCount" INTEGER NOT NULL DEFAULT 0, "discrepancies" JSONB NOT NULL DEFAULT '[]',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);
INSERT INTO "SettlementConfig" ("id", "name", "holdDays", "status", "activatedAt", "createdAt", "updatedAt")
VALUES ('settlement-v1', 'Phase 5 default settlement', 7, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Preserve existing wallet caches as a balanced opening ledger.
INSERT INTO "LedgerAccount" ("id", "key", "ownerUserId", "type", "currency", "balance", "createdAt", "updatedAt")
SELECT 'la_' || md5("userId" || ':available:' || "currency"), 'creator:' || "userId" || ':available:' || "currency", "userId", 'creator_available', "currency", "available", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WalletBalance" WHERE "available" <> 0;
INSERT INTO "LedgerAccount" ("id", "key", "ownerUserId", "type", "currency", "balance", "createdAt", "updatedAt")
SELECT 'la_' || md5("userId" || ':pending:' || "currency"), 'creator:' || "userId" || ':pending:' || "currency", "userId", 'creator_pending', "currency", "pending", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WalletBalance" WHERE "pending" <> 0;
INSERT INTO "LedgerAccount" ("id", "key", "ownerUserId", "type", "currency", "balance", "createdAt", "updatedAt")
SELECT 'la_' || md5("userId" || ':reserved:' || "currency"), 'creator:' || "userId" || ':reserved:' || "currency", "userId", 'creator_reserved', "currency", "reserved", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WalletBalance" WHERE "reserved" <> 0;
INSERT INTO "LedgerAccount" ("id", "key", "ownerUserId", "type", "currency", "balance", "createdAt", "updatedAt")
SELECT 'la_' || md5("userId" || ':debt:' || "currency"), 'creator:' || "userId" || ':debt:' || "currency", "userId", 'creator_debt', "currency", -"debt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WalletBalance" WHERE "debt" <> 0;

INSERT INTO "LedgerAccount" ("id", "key", "type", "currency", "balance", "createdAt", "updatedAt")
SELECT 'la_' || md5('opening-equity:' || "currency"), 'platform:opening_equity:' || "currency", 'opening_equity', "currency", -SUM("balance"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "LedgerAccount" WHERE "ownerUserId" IS NOT NULL GROUP BY "currency";
INSERT INTO "LedgerTransaction" ("id", "idempotencyKey", "type", "referenceType", "referenceId", "currency", "status", "metadata", "createdAt")
SELECT 'lt_' || md5('phase5-opening:' || "currency"), 'migration:phase5:opening:' || "currency", 'opening_balance', 'migration', 'phase-5', "currency", 'posted', '{"source":"WalletBalance"}', CURRENT_TIMESTAMP
FROM "LedgerAccount" GROUP BY "currency";
INSERT INTO "LedgerEntry" ("id", "transactionId", "accountId", "amount", "createdAt")
SELECT 'le_' || md5("id" || ':phase5-opening'), 'lt_' || md5('phase5-opening:' || "currency"), "id", "balance", CURRENT_TIMESTAMP
FROM "LedgerAccount";
