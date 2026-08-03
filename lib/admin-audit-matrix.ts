import { Prisma } from "@prisma/client";
import type { AdminContext } from "./admin-auth";

export const ADMIN_MUTATION_AUDIT_MATRIX = [
  { route: "channels/[id]/restore/route.ts", action: "channel.restore", targetType: "channel" },
  { route: "channels/[id]/review/route.ts", action: "channel.review", targetType: "channel" },
  { route: "channels/[id]/route.ts", action: "channel.update", targetType: "channel" },
  { route: "channels/[id]/suspend/route.ts", action: "channel.suspend", targetType: "channel" },
  { route: "channels/[id]/takeover/route.ts", action: "channel.takeover", targetType: "channel" },
  { route: "channels/quotas/[userId]/route.ts", action: "channel.quota.update", targetType: "user" },
  { route: "channels/route.ts", action: "channel.create", targetType: "channel" },
  { route: "content/[id]/route.ts", action: "content.moderate", targetType: "post" },
  { route: "creator-applications/[id]/review/route.ts", action: "admin.creator_application.review", targetType: "creator_application" },
  { route: "creator-levels/[id]/route.ts", action: "admin.creator_level.update", targetType: "creator_level" },
  { route: "creator-levels/route.ts", action: "admin.creator_level.create", targetType: "creator_level" },
  { route: "finance/fee-configs/[id]/activate/route.ts", action: "finance.fee_config.activate", targetType: "platform_fee_config" },
  { route: "finance/fee-configs/route.ts", action: "finance.fee_config.create", targetType: "platform_fee_config" },
  { route: "finance/kyc-cases/route.ts", action: "finance.kyc.review", targetType: "kyc_case" },
  { route: "finance/orders/[id]/refund/route.ts", action: "finance.order.refund", targetType: "order" },
  { route: "finance/payout-requests/route.ts", action: "finance.payout.review", targetType: "payout_request" },
  { route: "finance/reconciliation/route.ts", action: "finance.reconciliation.run", targetType: "reconciliation_run" },
  { route: "finance/settlement-configs/[id]/activate/route.ts", action: "finance.settlement.activate", targetType: "settlement_config" },
  { route: "finance/settlement-configs/route.ts", action: "finance.settlement_config.create", targetType: "settlement_config" },
  { route: "finance/settlements/run/route.ts", action: "finance.settlements.run", targetType: "settlement_batch" },
  { route: "payment-channels/[provider]/route.ts", action: "admin.payment_channel.update", targetType: "payment_channel" },
  { route: "pricing/versions/[id]/publish/route.ts", action: "admin.pricing_version.publish", targetType: "pricing_version" },
  { route: "pricing/versions/route.ts", action: "admin.pricing_version.create", targetType: "pricing_version" },
  { route: "search/reindex/route.ts", action: "search.reindex", targetType: "channel_job" },
  { route: "users/[id]/route.ts", action: "admin.user.update", targetType: "user" }
] as const;

type AuditTransaction = Pick<Prisma.TransactionClient, "auditLog">;
type AdminMutationAudit = {
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
};

export async function auditAdminMutation<T>(
  tx: AuditTransaction,
  admin: AdminContext,
  audit: AdminMutationAudit | ((result: T) => AdminMutationAudit),
  mutate: () => Promise<T>
): Promise<T> {
  const result = await mutate();
  const record = typeof audit === "function" ? audit(result) : audit;
  await tx.auditLog.create({
    data: {
      actorUserId: admin.actorUserId,
      actorRole: admin.role,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      metadata: record.metadata ?? {}
    }
  });
  return result;
}
