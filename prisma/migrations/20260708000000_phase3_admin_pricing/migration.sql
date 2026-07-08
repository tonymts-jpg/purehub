-- Phase 3 admin, pricing versioning, payment channel configuration, and audit logs.

CREATE TABLE "PricingVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingVersion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PricingVersion" ("id", "name", "status", "publishedAt", "createdAt", "updatedAt")
VALUES ('pricing-v1', 'Phase 2 baseline pricing', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "CreatorLevel" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PriceTier" ADD COLUMN "pricingVersionId" TEXT NOT NULL DEFAULT 'pricing-v1';

CREATE TABLE "AdminAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentChannelConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "currencies" JSONB NOT NULL,
    "regions" JSONB NOT NULL,
    "feeNote" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL,
    "statusNote" TEXT NOT NULL DEFAULT 'not_configured',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentChannelConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminAccount_userId_role_key" ON "AdminAccount"("userId", "role");
CREATE UNIQUE INDEX "PaymentChannelConfig_provider_key" ON "PaymentChannelConfig"("provider");

ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminAccount" ADD CONSTRAINT "AdminAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PaymentChannelConfig" ("id", "provider", "enabled", "mode", "currencies", "regions", "feeNote", "config", "statusNote", "createdAt", "updatedAt") VALUES
('pay-stripe', 'stripe', false, 'test', '["CNY","USD"]', '["global"]', 'Configured in Phase 4 before real payments.', '{}', 'not_configured', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('pay-paypal', 'paypal', false, 'test', '["USD"]', '["global"]', 'Sandbox only until Phase 4 payment adapter is enabled.', '{}', 'not_configured', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('pay-card', 'card', false, 'test', '["CNY","USD"]', '["global"]', 'Card routing follows the selected provider in Phase 4.', '{}', 'not_configured', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('pay-alipay-intl', 'alipay_intl', false, 'test', '["CNY","USD"]', '["CN","global"]', 'International merchant eligibility must be confirmed.', '{}', 'not_configured', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('pay-wechatpay-intl', 'wechatpay_intl', false, 'test', '["CNY","USD"]', '["CN","global"]', 'International merchant eligibility must be confirmed.', '{}', 'not_configured', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('pay-usdt', 'usdt', false, 'test', '["USDT"]', '["global"]', 'TRC20 and ERC20 are default staging options.', '{"networks":["TRC20","ERC20"],"minConfirmations":12,"orderTtlMinutes":30,"rateSource":"admin_fixed_rate"}', 'not_configured', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
