import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { prisma } from "../lib/prisma";

type AcceptanceIdentity = {
  id: string;
  email: string;
};

export type Phase7MediaLifecycleCleanupScope = {
  identities: AcceptanceIdentity[];
  postIds: Set<string>;
  assetIds: Set<string>;
  assetKinds: Map<string, string>;
  orderIds: Set<string>;
  objectKeys: Set<string>;
  ledgerAccountIdsToDelete: Set<string>;
  ledgerAccountBalancesBefore: Map<string, number>;
  ledgerAccountIdsToVerify: Set<string>;
  webhookEventIds: Set<string>;
};

const SHARED_ACCEPTANCE_USER_IDS = new Set([
  "fan-demo",
  "c1",
  "c2",
  "c3",
  "admin-demo",
  "support-demo"
]);

export function createPhase7MediaLifecycleCleanupScope(): Phase7MediaLifecycleCleanupScope {
  return {
    identities: [],
    postIds: new Set(),
    assetIds: new Set(),
    assetKinds: new Map(),
    orderIds: new Set(),
    objectKeys: new Set(),
    ledgerAccountIdsToDelete: new Set(),
    ledgerAccountBalancesBefore: new Map(),
    ledgerAccountIdsToVerify: new Set(),
    webhookEventIds: new Set()
  };
}

function storageClient() {
  return new S3Client({
    region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1",
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY!,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY!
    }
  });
}

function storageBucket() {
  return process.env.OBJECT_STORAGE_BUCKET ?? "purehub-media";
}

export function objectStorageTestConfigAvailable() {
  return Boolean(
    process.env.OBJECT_STORAGE_ENDPOINT
    && process.env.OBJECT_STORAGE_ACCESS_KEY
    && process.env.OBJECT_STORAGE_SECRET_KEY
  );
}

function assertSafeScope(scope: Phase7MediaLifecycleCleanupScope) {
  const identityIds = new Set(scope.identities.map(({ id }) => id));
  if (identityIds.size !== scope.identities.length) throw new Error("Cleanup identities must be unique.");
  for (const identity of scope.identities) {
    if (
      !identity.id
      || SHARED_ACCEPTANCE_USER_IDS.has(identity.id)
      || !identity.email.endsWith("@e2e.purehub.local")
    ) {
      throw new Error("Cleanup is restricted to isolated E2E identities.");
    }
  }

  for (const objectKey of scope.objectKeys) {
    const ownedOriginal = [...identityIds].some((id) => objectKey.startsWith(`original/${id}/`));
    const ownedDerivative = [...scope.assetIds].some((id) => objectKey.startsWith(`derivatives/${id}/`));
    if (!ownedOriginal && !ownedDerivative) {
      throw new Error("Cleanup object keys must belong to an exact isolated identity or asset.");
    }
  }
  if ([...scope.ledgerAccountIdsToDelete].some((id) => scope.ledgerAccountBalancesBefore.has(id))) {
    throw new Error("Cleanup cannot delete a ledger account recorded as pre-existing.");
  }
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.$metadata?.httpStatusCode === 404
    || candidate.name === "NotFound"
    || candidate.name === "NoSuchKey"
    || candidate.Code === "NoSuchKey";
}

async function assertObjectsAbsent(objectKeys: string[]) {
  if (!objectKeys.length) return;
  if (!objectStorageTestConfigAvailable()) throw new Error("Object storage test configuration is unavailable.");
  const client = storageClient();
  try {
    for (const key of objectKeys) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: storageBucket(), Key: key }));
        throw new Error(`Acceptance object cleanup failed for ${key}.`);
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    }
  } finally {
    client.destroy();
  }
}

export function lifecycleObjectKeysForAsset(asset: {
  id: string;
  kind: string;
  storageKey: string | null;
  derivativeKey: string | null;
}) {
  const keys = new Set<string>();
  if (asset.storageKey) keys.add(asset.storageKey);
  if (asset.derivativeKey) keys.add(asset.derivativeKey);
  if (asset.kind === "image") keys.add(`derivatives/${asset.id}/watermarked.jpg`);
  return [...keys];
}

export async function putPhase7LifecycleTestObject(key: string, body: Buffer, contentType = "video/mp4") {
  if (!objectStorageTestConfigAvailable()) throw new Error("Object storage test configuration is unavailable.");
  const client = storageClient();
  try {
    await client.send(new PutObjectCommand({
      Bucket: storageBucket(),
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: contentType
    }));
  } finally {
    client.destroy();
  }
}

async function deleteObjectsThroughRaceWindow(objectKeys: string[]) {
  if (!objectKeys.length) return;
  if (!objectStorageTestConfigAvailable()) throw new Error("Object storage test configuration is unavailable.");
  const client = storageClient();
  const retryDelaysMs = [0, 100, 200, 400, 800];
  try {
    for (const delayMs of retryDelaysMs) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      for (const key of objectKeys) {
        await client.send(new DeleteObjectCommand({ Bucket: storageBucket(), Key: key }));
      }
      await assertObjectsAbsent(objectKeys);
    }
  } finally {
    client.destroy();
  }
}

export async function cleanupPhase7MediaLifecycle(scope: Phase7MediaLifecycleCleanupScope) {
  assertSafeScope(scope);
  const identityIds = scope.identities.map(({ id }) => id);
  const identityEmails = scope.identities.map(({ email }) => email);
  const postIds = [...scope.postIds];
  const assetIds = [...scope.assetIds];
  const orderIds = [...scope.orderIds];

  for (const [assetId, kind] of scope.assetKinds) {
    if (kind === "image") scope.objectKeys.add(`derivatives/${assetId}/watermarked.jpg`);
  }
  const storedAssets = assetIds.length
    ? await prisma.mediaAsset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, uploaderUserId: true, kind: true, storageKey: true, derivativeKey: true }
    })
    : [];
  for (const asset of storedAssets) {
    if (!asset.uploaderUserId || !identityIds.includes(asset.uploaderUserId)) {
      throw new Error("Cleanup media must belong to an isolated E2E identity.");
    }
    scope.assetKinds.set(asset.id, asset.kind);
    lifecycleObjectKeysForAsset(asset).forEach((key) => scope.objectKeys.add(key));
  }
  assertSafeScope(scope);

  await prisma.$transaction(async (tx) => {
    const existingUsers = identityIds.length
      ? await tx.user.findMany({
        where: { id: { in: identityIds } },
        select: { id: true, email: true }
      })
      : [];
    for (const user of existingUsers) {
      const identity = scope.identities.find(({ id }) => id === user.id);
      if (!identity || identity.email !== user.email) {
        throw new Error("Cleanup identity no longer matches its exact E2E email.");
      }
    }

    const existingPosts = postIds.length
      ? await tx.post.findMany({ where: { id: { in: postIds } }, select: { id: true, creatorId: true } })
      : [];
    if (existingPosts.some(({ creatorId }) => !identityIds.includes(creatorId))) {
      throw new Error("Cleanup posts must belong to an isolated E2E creator.");
    }

    const existingOrders = orderIds.length
      ? await tx.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, buyerUserId: true, creatorUserId: true }
      })
      : [];
    if (existingOrders.some(({ buyerUserId, creatorUserId }) => (
      !identityIds.includes(buyerUserId) || !identityIds.includes(creatorUserId)
    ))) {
      throw new Error("Cleanup orders must be isolated to exact E2E identities.");
    }

    if (assetIds.length) {
      await tx.mediaAsset.updateMany({
        where: { id: { in: assetIds }, uploaderUserId: { in: identityIds } },
        data: { status: "cleanup_pending" }
      });
    }

    const ownedLedgerAccounts = identityIds.length
      ? await tx.ledgerAccount.findMany({
        where: { ownerUserId: { in: identityIds } },
        select: { id: true, ownerUserId: true }
      })
      : [];
    for (const account of ownedLedgerAccounts) {
      if (!account.ownerUserId || !identityIds.includes(account.ownerUserId)) {
        throw new Error("Cleanup discovered a ledger account outside isolated E2E ownership.");
      }
      scope.ledgerAccountBalancesBefore.delete(account.id);
      scope.ledgerAccountIdsToVerify.delete(account.id);
      scope.ledgerAccountIdsToDelete.add(account.id);
    }

    const ledgerTransactions = orderIds.length
      ? await tx.ledgerTransaction.findMany({
        where: { referenceType: "order", referenceId: { in: orderIds } },
        include: { entries: true }
      })
      : [];
    for (const ledger of ledgerTransactions) {
      for (const entry of ledger.entries) {
        if (scope.ledgerAccountBalancesBefore.has(entry.accountId)) {
          scope.ledgerAccountIdsToVerify.add(entry.accountId);
        } else {
          const account = await tx.ledgerAccount.findUnique({
            where: { id: entry.accountId },
            select: { ownerUserId: true }
          });
          if (account?.ownerUserId && !identityIds.includes(account.ownerUserId)) {
            throw new Error("Cleanup refuses to delete a ledger account owned by a shared user.");
          }
          scope.ledgerAccountIdsToDelete.add(entry.accountId);
        }
        await tx.ledgerAccount.update({
          where: { id: entry.accountId },
          data: { balance: { decrement: entry.amount } }
        });
      }
    }
    if (ledgerTransactions.length) {
      await tx.ledgerTransaction.deleteMany({ where: { id: { in: ledgerTransactions.map(({ id }) => id) } } });
    }

    if (orderIds.length) {
      await tx.entitlement.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.subscription.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.notification.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.transaction.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.paymentTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.paymentIntent.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.refund.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (scope.webhookEventIds.size) {
      await tx.webhookEvent.deleteMany({ where: { id: { in: [...scope.webhookEventIds] } } });
    }
    if (postIds.length) {
      await tx.searchDocument.deleteMany({ where: { entityType: "post", entityId: { in: postIds } } });
      await tx.channelJob.deleteMany({ where: { entityType: "post", entityId: { in: postIds } } });
    }
    if (assetIds.length) {
      await tx.mediaAsset.deleteMany({ where: { id: { in: assetIds } } });
    }
    if (postIds.length) {
      await tx.post.deleteMany({ where: { id: { in: postIds } } });
    }
    const requestedLedgerAccountIds = [...scope.ledgerAccountIdsToDelete];
    if (requestedLedgerAccountIds.length) {
      await tx.ledgerAccount.deleteMany({
        where: { id: { in: requestedLedgerAccountIds }, entries: { none: {} } }
      });
    }
    if (identityIds.length) {
      await tx.verification.deleteMany({ where: { identifier: { in: identityEmails } } });
      await tx.user.deleteMany({
        where: {
          id: { in: identityIds },
          email: { in: identityEmails, endsWith: "@e2e.purehub.local" }
        }
      });
    }
  });

  const objectKeys = [...scope.objectKeys];
  await deleteObjectsThroughRaceWindow(objectKeys);
  await assertPhase7MediaLifecycleAbsent(scope);
}

export async function assertPhase7MediaLifecycleAbsent(scope: Phase7MediaLifecycleCleanupScope) {
  assertSafeScope(scope);
  const identityIds = scope.identities.map(({ id }) => id);
  const postIds = [...scope.postIds];
  const assetIds = [...scope.assetIds];
  const orderIds = [...scope.orderIds];
  const checks = await Promise.all([
    prisma.user.count({ where: { id: { in: identityIds } } }),
    prisma.post.count({ where: { id: { in: postIds } } }),
    prisma.mediaAsset.count({ where: { id: { in: assetIds } } }),
    prisma.order.count({ where: { id: { in: orderIds } } }),
    prisma.paymentIntent.count({ where: { orderId: { in: orderIds } } }),
    prisma.paymentTransaction.count({ where: { orderId: { in: orderIds } } }),
    prisma.entitlement.count({ where: { orderId: { in: orderIds } } }),
    prisma.subscription.count({ where: { orderId: { in: orderIds } } }),
    prisma.transaction.count({ where: { orderId: { in: orderIds } } }),
    prisma.notification.count({ where: { orderId: { in: orderIds } } }),
    prisma.walletBalance.count({ where: { userId: { in: identityIds } } }),
    prisma.ledgerTransaction.count({ where: { referenceType: "order", referenceId: { in: orderIds } } }),
    prisma.ledgerAccount.count({ where: { id: { in: [...scope.ledgerAccountIdsToDelete] } } }),
    prisma.ledgerAccount.count({ where: { ownerUserId: { in: identityIds } } }),
    prisma.searchDocument.count({ where: { entityType: "post", entityId: { in: postIds } } }),
    prisma.channelJob.count({ where: { entityType: "post", entityId: { in: postIds } } }),
    prisma.webhookEvent.count({ where: { id: { in: [...scope.webhookEventIds] } } })
  ]);
  if (checks.some((count) => count !== 0)) {
    throw new Error(`Phase 7 lifecycle cleanup left database rows: ${checks.join(",")}`);
  }
  if (scope.ledgerAccountIdsToVerify.size) {
    const restoredAccounts = await prisma.ledgerAccount.findMany({
      where: { id: { in: [...scope.ledgerAccountIdsToVerify] } },
      select: { id: true, balance: true }
    });
    if (
      restoredAccounts.length !== scope.ledgerAccountIdsToVerify.size
      || restoredAccounts.some(({ id, balance }) => scope.ledgerAccountBalancesBefore.get(id) !== balance)
    ) {
      throw new Error("Phase 7 lifecycle cleanup did not restore exact shared ledger balances.");
    }
  }
  await assertObjectsAbsent([...scope.objectKeys]);
}
