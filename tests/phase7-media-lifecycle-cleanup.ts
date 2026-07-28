import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { prisma } from "../lib/prisma";
import { mediaProcessingAttemptKey } from "../lib/storage/media";

type AcceptanceIdentity = {
  id: string;
  email: string;
};

export type Phase7MediaLifecycleCleanupScope = {
  identities: AcceptanceIdentity[];
  identityEmails: Set<string>;
  postIds: Set<string>;
  assetIds: Set<string>;
  assetKinds: Map<string, string>;
  orderIds: Set<string>;
  objectKeys: Set<string>;
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
    identityEmails: new Set(),
    postIds: new Set(),
    assetIds: new Set(),
    assetKinds: new Map(),
    orderIds: new Set(),
    objectKeys: new Set(),
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
  const identityEmails = new Set([
    ...scope.identityEmails,
    ...scope.identities.map(({ email }) => email)
  ]);
  if (identityIds.size !== scope.identities.length) throw new Error("Cleanup identities must be unique.");
  for (const email of identityEmails) {
    if (!email.endsWith("@e2e.purehub.local")) {
      throw new Error("Cleanup is restricted to exact E2E emails.");
    }
  }
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
}

async function rediscoverExactIdentities(scope: Phase7MediaLifecycleCleanupScope) {
  assertSafeScope(scope);
  const emails = [...new Set([
    ...scope.identityEmails,
    ...scope.identities.map(({ email }) => email)
  ])];
  if (!emails.length) return;
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true }
  });
  for (const user of users) {
    if (SHARED_ACCEPTANCE_USER_IDS.has(user.id) || !user.email.endsWith("@e2e.purehub.local")) {
      throw new Error("Rediscovered cleanup identity is not an isolated E2E user.");
    }
    const recordedById = scope.identities.find(({ id }) => id === user.id);
    const recordedByEmail = scope.identities.find(({ email }) => email === user.email);
    if (
      (recordedById && recordedById.email !== user.email)
      || (recordedByEmail && recordedByEmail.id !== user.id)
    ) {
      throw new Error("Rediscovered cleanup identity does not match the exact recorded identity.");
    }
    if (!recordedById) scope.identities.push(user);
  }
  assertSafeScope(scope);
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.$metadata?.httpStatusCode === 404
    || candidate.name === "NotFound"
    || candidate.name === "NoSuchKey"
    || candidate.Code === "NoSuchKey";
}

export function lifecycleObjectKeysForAsset(asset: {
  id: string;
  kind: string;
  storageKey: string | null;
  derivativeKey: string | null;
  status?: string;
}) {
  const keys = new Set<string>();
  if (asset.storageKey) keys.add(asset.storageKey);
  if (asset.derivativeKey) keys.add(asset.derivativeKey);
  if (asset.kind === "image") {
    if (
      asset.status?.startsWith("processing_claimed:")
      || asset.status?.startsWith("processing_recovering:")
    ) {
      keys.add(mediaProcessingAttemptKey(asset.id, asset.status));
    }
    keys.add(`derivatives/${asset.id}/watermarked.jpg`);
  }
  return [...keys];
}

type CleanupMediaRecord = {
  id: string;
  uploaderUserId: string | null;
  kind: string;
  storageKey: string | null;
  derivativeKey: string | null;
  status: string;
};

type CleanupMediaDatabase = {
  findFirst(input: {
    where: { id: string; uploaderUserId: { in: string[] } };
    select: Record<keyof CleanupMediaRecord, true>;
  }): Promise<CleanupMediaRecord | null>;
  updateMany(input: {
    where: { id: string; uploaderUserId: { in: string[] }; status: string };
    data: { status: string };
  }): Promise<{ count: number }>;
};

export async function quiescePhase7MediaAssetForCleanup(input: {
  assetId: string;
  identityIds: string[];
  database: CleanupMediaDatabase;
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await input.database.findFirst({
      where: { id: input.assetId, uploaderUserId: { in: input.identityIds } },
      select: {
        id: true,
        uploaderUserId: true,
        kind: true,
        storageKey: true,
        derivativeKey: true,
        status: true
      }
    });
    if (!current) return null;
    const claimed = await input.database.updateMany({
      where: {
        id: current.id,
        uploaderUserId: { in: input.identityIds },
        status: current.status
      },
      data: { status: "cleanup_pending" }
    });
    if (claimed.count === 1) return current;
  }
  throw new Error(`Cleanup could not quiesce exact media asset ${input.assetId}.`);
}

type CleanupObjectStore = {
  listObjects(prefix: string, continuationToken?: string): Promise<{
    keys: string[];
    nextToken?: string;
  }>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  destroy?: () => void;
};

function defaultCleanupObjectStore(): CleanupObjectStore {
  const client = storageClient();
  return {
    listObjects: async (prefix, continuationToken) => {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: storageBucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      return {
        keys: (listed.Contents ?? []).flatMap((object) => object.Key ? [object.Key] : []),
        ...(listed.IsTruncated && listed.NextContinuationToken
          ? { nextToken: listed.NextContinuationToken }
          : {})
      };
    },
    deleteObject: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: storageBucket(), Key: key }));
    },
    objectExists: async (key) => {
      try {
        await client.send(new HeadObjectCommand({ Bucket: storageBucket(), Key: key }));
        return true;
      } catch (error) {
        if (isMissingObject(error)) return false;
        throw error;
      }
    },
    destroy: () => client.destroy()
  };
}

async function listExactDerivativePrefixes(
  scope: Phase7MediaLifecycleCleanupScope,
  store: CleanupObjectStore
) {
  const keys: string[] = [];
  for (const assetId of scope.assetIds) {
    let continuationToken: string | undefined;
    do {
      const listed = await store.listObjects(`derivatives/${assetId}/`, continuationToken);
      keys.push(...listed.keys);
      continuationToken = listed.nextToken;
    } while (continuationToken);
  }
  return keys;
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

export async function deletePhase7MediaObjectsThroughRaceWindow(
  scope: Phase7MediaLifecycleCleanupScope,
  options: {
    store?: CleanupObjectStore;
    delaysMs?: number[];
  } = {}
) {
  assertSafeScope(scope);
  if (!options.store && !objectStorageTestConfigAvailable()) {
    if (!scope.objectKeys.size) return;
    throw new Error("Object storage test configuration is unavailable.");
  }
  const store = options.store ?? defaultCleanupObjectStore();
  const retryDelaysMs = options.delaysMs ?? [0, 100, 200, 400, 800, 1000];
  let consecutiveCleanObservations = 0;
  try {
    for (const delayMs of retryDelaysMs) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const beforeDelete = await listExactDerivativePrefixes(scope, store);
      beforeDelete.forEach((key) => scope.objectKeys.add(key));
      for (const key of scope.objectKeys) {
        await store.deleteObject(key);
      }
      const afterDelete = await listExactDerivativePrefixes(scope, store);
      afterDelete.forEach((key) => scope.objectKeys.add(key));
      let knownObjectExists = false;
      for (const key of scope.objectKeys) {
        if (await store.objectExists(key)) knownObjectExists = true;
      }
      const clean = afterDelete.length === 0 && !knownObjectExists;
      consecutiveCleanObservations = clean ? consecutiveCleanObservations + 1 : 0;
      if (consecutiveCleanObservations >= 2) return;
    }
    throw new Error("Acceptance media object cleanup did not reach two consecutive clean observations.");
  } finally {
    store.destroy?.();
  }
}

export async function cleanupPhase7MediaLifecycle(scope: Phase7MediaLifecycleCleanupScope) {
  await rediscoverExactIdentities(scope);
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

    for (const assetId of assetIds) {
      const claimed = await quiescePhase7MediaAssetForCleanup({
        assetId,
        identityIds,
        database: tx.mediaAsset as unknown as CleanupMediaDatabase
      });
      if (claimed) lifecycleObjectKeysForAsset(claimed).forEach((key) => scope.objectKeys.add(key));
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
    }

    const ledgerTransactions = orderIds.length
      ? await tx.ledgerTransaction.findMany({
        where: { referenceType: "order", referenceId: { in: orderIds } },
        include: { entries: true }
      })
      : [];
    const ledgerEntryAccountIds = [...new Set(
      ledgerTransactions.flatMap(({ entries }) => entries.map(({ accountId }) => accountId))
    )];
    const ledgerEntryAccounts = ledgerEntryAccountIds.length
      ? await tx.ledgerAccount.findMany({
        where: { id: { in: ledgerEntryAccountIds } },
        select: { id: true, ownerUserId: true }
      })
      : [];
    const ledgerEntryAccountById = new Map(ledgerEntryAccounts.map((account) => [account.id, account]));
    for (const accountId of ledgerEntryAccountIds) {
      const account = ledgerEntryAccountById.get(accountId);
      if (!account) throw new Error("Cleanup ledger entry account is missing.");
      const isolatedOwner = Boolean(account.ownerUserId && identityIds.includes(account.ownerUserId));
      if (!isolatedOwner && !scope.ledgerAccountBalancesBefore.has(account.id)) {
        throw new Error("Cleanup refuses an unexpected shared or unowned ledger account absent from the snapshot.");
      }
      if (!isolatedOwner) scope.ledgerAccountIdsToVerify.add(account.id);
    }
    for (const ledger of ledgerTransactions) {
      for (const entry of ledger.entries) {
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
    const ownedLedgerAccountIds = ownedLedgerAccounts.map(({ id }) => id);
    if (ownedLedgerAccountIds.length) {
      await tx.ledgerAccount.deleteMany({
        where: {
          id: { in: ownedLedgerAccountIds },
          ownerUserId: { in: identityIds },
          entries: { none: {} }
        }
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

  await deletePhase7MediaObjectsThroughRaceWindow(scope);
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
  await deletePhase7MediaObjectsThroughRaceWindow(scope);
}
