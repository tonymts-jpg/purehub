import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import {
  acceptsUploadMediaType,
  normalizeByteRange,
  resolveStaticMediaRedirect,
  UPLOAD_MAX_SIZE_BYTES,
  uploadSizeBytesSchema
} from "../lib/storage/media-policy";
import { prisma } from "../lib/prisma";
import { writeDerivativeWithConditionalCommit } from "../lib/storage/media-finalization";
import { authHeaders, hasDatabase, signInCreator } from "./auth-helpers";
import {
  assertPhase7MediaLifecycleAbsent,
  cleanupPhase7MediaLifecycle,
  createPhase7MediaLifecycleCleanupScope,
  deletePhase7MediaObjectsThroughRaceWindow,
  lifecycleObjectKeysForAsset,
  objectStorageTestConfigAvailable,
  putPhase7LifecycleTestObject,
  quiescePhase7MediaAssetForCleanup
} from "./phase7-media-lifecycle-cleanup";

test("media MIME policy rejects active content and kind mismatches", () => {
  for (const mimeType of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]) {
    expect(acceptsUploadMediaType({ kind: "image", mimeType })).toBe(true);
  }
  for (const mimeType of ["video/mp4", "video/webm"]) {
    expect(acceptsUploadMediaType({ kind: "video", mimeType })).toBe(true);
  }

  for (const input of [
    { kind: "image" as const, mimeType: "image/svg+xml" },
    { kind: "image" as const, mimeType: "text/html" },
    { kind: "video" as const, mimeType: "image/svg+xml" },
    { kind: "video" as const, mimeType: "image/png" },
    { kind: "image" as const, mimeType: "video/mp4" },
    { kind: "video" as const, mimeType: "application/xml" },
    { kind: "video" as const, mimeType: "video/mp4; charset=utf-8" }
  ]) {
    expect(acceptsUploadMediaType(input)).toBe(false);
  }
});

test("static media redirect policy permits only passive same-origin generated assets", () => {
  const requestUrl = "https://purehub.example/api/media/asset/content";
  expect(resolveStaticMediaRedirect("/generated/posts/post-1/01.webp", requestUrl).href)
    .toBe("https://purehub.example/generated/posts/post-1/01.webp");

  for (const src of [
    "https://evil.example/payload.svg",
    "//evil.example/payload.svg",
    "/\\evil.example/payload.svg",
    "/%5c%5cevil.example/payload.svg",
    "/generated/%255c%255cevil.example/payload.webp",
    "/api/media/asset/access",
    "/api/health",
    "/generated/../api/health",
    "/generated/%2e%2e/api/health",
    "/generated/payload.svg",
    "/generated/payload.html",
    "/generated/posts/post-1/01.webp?redirect=https://evil.example"
  ]) {
    expect(() => resolveStaticMediaRedirect(src, requestUrl)).toThrow();
  }
});

test("byte range policy normalizes valid ranges and rejects unsatisfiable requests", () => {
  expect(normalizeByteRange("bytes=2-6", 16)).toBe("bytes=2-6");
  expect(normalizeByteRange("bytes=4-", 16)).toBe("bytes=4-");
  expect(normalizeByteRange("bytes=-5", 16)).toBe("bytes=-5");

  for (const range of [
    "items=0-1",
    "bytes=",
    "bytes=4-2",
    "bytes=16-20",
    "bytes=-0",
    "bytes=0-1,4-5"
  ]) {
    expect(() => normalizeByteRange(range, 16)).toThrow();
  }
});

test("upload API and scoped nginx proxy limits align at the 500 MB boundary", () => {
  expect(uploadSizeBytesSchema.safeParse(UPLOAD_MAX_SIZE_BYTES - 1).success).toBe(true);
  expect(uploadSizeBytesSchema.safeParse(UPLOAD_MAX_SIZE_BYTES).success).toBe(true);
  expect(uploadSizeBytesSchema.safeParse(UPLOAD_MAX_SIZE_BYTES + 1).success).toBe(false);

  const nginx = readFileSync(resolve(process.cwd(), "infra/nginx/default.conf"), "utf8");
  const uploadLocation = nginx.match(
    /location\s+~\s+\^\/api\/uploads\/\[\^\/\]\+\/content\$\s*\{([\s\S]*?)\n\s*\}/
  )?.[1];
  expect(uploadLocation, "nginx must scope the larger body limit to the upload content PUT route").toBeTruthy();
  const nginxUploadLimitMb = Number(uploadLocation?.match(/\bclient_max_body_size\s+(\d+)m\s*;/)?.[1]);
  expect(nginxUploadLimitMb * 1024 * 1024).toBeGreaterThanOrEqual(UPLOAD_MAX_SIZE_BYTES);
  expect(nginx).toMatch(/\bclient_max_body_size\s+100m\s*;/);
});

test("lifecycle cleanup refuses shared seeded identities", async () => {
  const scope = createPhase7MediaLifecycleCleanupScope();
  scope.identities.push({ id: "fan-demo", email: "shared-user@e2e.purehub.local" });
  await expect(cleanupPhase7MediaLifecycle(scope)).rejects.toThrow(
    "Cleanup is restricted to isolated E2E identities."
  );
});

test("lifecycle cleanup derives an image derivative key before the worker records it", () => {
  const claimStatus = "processing_claimed:44444444-4444-4444-8444-444444444444";
  expect(lifecycleObjectKeysForAsset({
    id: "isolated-asset",
    kind: "image",
    storageKey: "original/isolated-user/source.png",
    derivativeKey: "derivatives/isolated-asset/attempts/committed.jpg",
    status: claimStatus
  })).toEqual([
    "original/isolated-user/source.png",
    "derivatives/isolated-asset/attempts/committed.jpg",
    "derivatives/isolated-asset/attempts/44444444-4444-4444-8444-444444444444.jpg",
    "derivatives/isolated-asset/watermarked.jpg"
  ]);
});

test("lifecycle cleanup retries a lost status CAS and re-lists late exact-prefix objects without crossing assets", async () => {
  const assetId = "cleanup-cas-asset";
  const ownerId = "cleanup-cas-owner";
  const claimStatus = "processing_claimed:66666666-6666-4666-8666-666666666666";
  const lateAttemptKey = `derivatives/${assetId}/attempts/late-orphan.jpg`;
  const otherAssetKey = "derivatives/cleanup-other-asset/attempts/must-remain.jpg";
  const record = {
    id: assetId,
    uploaderUserId: ownerId,
    kind: "image",
    storageKey: `original/${ownerId}/source.png`,
    derivativeKey: null,
    status: "processing"
  };
  let casAttempts = 0;
  const claimed = await quiescePhase7MediaAssetForCleanup({
    assetId,
    identityIds: [ownerId],
    database: {
      findFirst: async () => ({ ...record }),
      updateMany: async ({ where, data }) => {
        casAttempts += 1;
        if (casAttempts === 1) {
          record.status = claimStatus;
          return { count: 0 };
        }
        if (
          where.id === record.id
          && where.uploaderUserId.in.includes(record.uploaderUserId)
          && where.status === record.status
        ) {
          record.status = data.status;
          return { count: 1 };
        }
        return { count: 0 };
      }
    }
  });

  expect(casAttempts).toBe(2);
  expect(record.status).toBe("cleanup_pending");
  expect(claimed?.status).toBe(claimStatus);

  const scope = createPhase7MediaLifecycleCleanupScope();
  scope.identities.push({ id: ownerId, email: `${ownerId}@e2e.purehub.local` });
  scope.assetIds.add(assetId);
  scope.assetKinds.set(assetId, "image");
  lifecycleObjectKeysForAsset(claimed!).forEach((key) => scope.objectKeys.add(key));
  const objects = new Map<string, Buffer>([[otherAssetKey, Buffer.from("other")]]);
  const deletedKeys: string[] = [];
  let listCalls = 0;
  await deletePhase7MediaObjectsThroughRaceWindow(scope, {
    delaysMs: [0, 0, 0, 0],
    store: {
      listObjects: async (prefix) => {
        listCalls += 1;
        const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
        if (listCalls === 1) objects.set(lateAttemptKey, Buffer.from("late"));
        return { keys };
      },
      deleteObject: async (key) => {
        deletedKeys.push(key);
        objects.delete(key);
      },
      objectExists: async (key) => objects.has(key)
    }
  });

  expect(listCalls).toBeGreaterThanOrEqual(4);
  expect(scope.objectKeys.has(lateAttemptKey)).toBe(true);
  expect(objects.has(lateAttemptKey)).toBe(false);
  expect(objects.get(otherAssetKey)?.toString()).toBe("other");
  expect(deletedKeys).not.toContain(otherAssetKey);
});

test("lifecycle cleanup accepts exact processing and claimed media assets", async ({ request }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared cleanup mutation runs once.");
  test.skip(!(await hasDatabase(request)), "Claimed media cleanup integration requires PostgreSQL.");

  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const userId = `claim-cleanup-user-${nonce}`;
  const email = `${userId}@e2e.purehub.local`;
  const assetIds = [
    `claim-cleanup-processing-${nonce}`,
    `claim-cleanup-claimed-${nonce}`
  ];
  const scope = createPhase7MediaLifecycleCleanupScope();
  scope.identities.push({ id: userId, email });
  scope.identityEmails.add(email);
  assetIds.forEach((id) => {
    scope.assetIds.add(id);
    scope.assetKinds.set(id, "video");
  });

  try {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Claim cleanup user",
        handle: `claim-cleanup-${nonce}`.slice(0, 30),
        avatar: "avatar-1",
        email
      }
    });
    await prisma.mediaAsset.createMany({
      data: assetIds.map((id, index) => ({
        id,
        uploaderUserId: userId,
        alt: "Claim cleanup media",
        width: 1,
        height: 1,
        order: index,
        kind: "video",
        mimeType: "video/mp4",
        sizeBytes: 1,
        status: index === 0
          ? "processing"
          : "processing_claimed:33333333-3333-4333-8333-333333333333",
        visibility: "public"
      }))
    });

    await cleanupPhase7MediaLifecycle(scope);
    await assertPhase7MediaLifecycleAbsent(scope);
  } finally {
    await cleanupPhase7MediaLifecycle(scope);
  }
});

test("worker compensates a derivative PUT when conditional status ownership is lost", async () => {
  const events: string[] = [];
  let objectExists = false;
  const committed = await writeDerivativeWithConditionalCommit({
    write: async () => {
      events.push("put");
      objectExists = true;
    },
    commit: async () => {
      events.push("conditional-commit-lost");
      return false;
    },
    remove: async () => {
      events.push("compensating-delete");
      objectExists = false;
    }
  });

  expect(committed).toBe(false);
  expect(objectExists).toBe(false);
  expect(events).toEqual(["put", "conditional-commit-lost", "compensating-delete"]);
});

test("upload API rejects SVG and MIME-kind mismatch before creating an asset", async ({ request }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared storage mutation runs once.");
  test.skip(!(await hasDatabase(request)), "Upload boundary integration requires PostgreSQL.");
  await signInCreator(request);

  for (const input of [
    { fileName: "active.svg", mimeType: "image/svg+xml", sizeBytes: 100, kind: "image", visibility: "public" },
    { fileName: "active-as-video.svg", mimeType: "image/svg+xml", sizeBytes: 100, kind: "video", visibility: "public" },
    { fileName: "mismatch.png", mimeType: "image/png", sizeBytes: 100, kind: "video", visibility: "public" },
    { fileName: "mismatch.mp4", mimeType: "video/mp4", sizeBytes: 100, kind: "image", visibility: "public" }
  ]) {
    const response = await request.post("/api/uploads/presign", { headers: authHeaders, data: input });
    expect(response.status(), await response.text()).toBe(400);
  }
});

test("media content route rejects legacy cross-origin and internal redirects", async ({ request }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared database fixture runs once.");
  test.skip(!(await hasDatabase(request)), "Legacy media redirect integration requires PostgreSQL.");
  const nonce = Date.now().toString(36);
  const fixtures = [
    { id: `media-redirect-authority-${nonce}`, src: "/\\evil.example/payload.webp" },
    { id: `media-redirect-internal-${nonce}`, src: "/api/health" }
  ];

  try {
    await prisma.mediaAsset.createMany({
      data: fixtures.map((fixture, order) => ({
        ...fixture,
        postId: "post-1",
        alt: "Rejected legacy redirect",
        width: 720,
        height: 900,
        order: 100 + order,
        kind: "image",
        mimeType: "image/webp",
        status: "ready",
        visibility: "public"
      }))
    });
    for (const fixture of fixtures) {
      const response = await request.get(`/api/media/${fixture.id}/content`, { maxRedirects: 0 });
      expect(response.status(), await response.text()).toBe(404);
      expect(response.headers()["location"]).toBeUndefined();
    }
  } finally {
    await prisma.mediaAsset.deleteMany({ where: { id: { in: fixtures.map(({ id }) => id) } } }).catch(() => undefined);
  }
});

test("isolated media lifecycle cleanup removes exact finance, identity, and object records idempotently", async ({ request }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared cleanup integration runs once.");
  test.skip(!(await hasDatabase(request)), "Lifecycle cleanup integration requires PostgreSQL.");
  test.skip(!objectStorageTestConfigAvailable(), "Lifecycle cleanup integration requires host-reachable object storage.");

  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const creatorId = `cleanup-creator-${nonce}`;
  const buyerId = `cleanup-buyer-${nonce}`;
  const creatorEmail = `${creatorId}@e2e.purehub.local`;
  const buyerEmail = `${buyerId}@e2e.purehub.local`;
  const postId = `cleanup-post-${nonce}`;
  const assetId = `cleanup-asset-${nonce}`;
  const orderId = `cleanup-order-${nonce}`;
  const objectKey = `original/${creatorId}/${nonce}.png`;
  const derivativeKey = `derivatives/${assetId}/watermarked.jpg`;
  const orphanAttemptKey = `derivatives/${assetId}/attempts/orphan-${nonce}.jpg`;
  const accountIds = [
    `cleanup-provider-${nonce}`,
    `cleanup-platform-${nonce}`,
    `cleanup-creator-account-${nonce}`
  ];
  const scope = createPhase7MediaLifecycleCleanupScope();
  scope.identities.push(
    { id: creatorId, email: creatorEmail },
    { id: buyerId, email: buyerEmail }
  );
  scope.identityEmails.add(creatorEmail);
  scope.identityEmails.add(buyerEmail);
  scope.postIds.add(postId);
  scope.assetIds.add(assetId);
  scope.assetKinds.set(assetId, "image");
  scope.orderIds.add(orderId);
  scope.objectKeys.add(objectKey);
  scope.ledgerAccountBalancesBefore.set(accountIds[0], 0);
  scope.ledgerAccountBalancesBefore.set(accountIds[1], 0);
  let delayedDerivativeWrite: Promise<void> | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          { id: creatorId, name: "Cleanup Creator", handle: `cc-${nonce}`.slice(0, 30), avatar: "avatar-1", email: creatorEmail, role: "creator", creatorStatus: "approved" },
          { id: buyerId, name: "Cleanup Buyer", handle: `cb-${nonce}`.slice(0, 30), avatar: "avatar-1", email: buyerEmail }
        ]
      });
      await tx.creatorProfile.create({
        data: { id: `cleanup-profile-${nonce}`, userId: creatorId, bio: "Cleanup fixture.", category: "Test", cover: "cover-1", levelId: "level-1" }
      });
      await tx.post.create({
        data: {
          id: postId,
          creatorId,
          title: "Exact cleanup fixture",
          excerpt: "Exact cleanup fixture excerpt.",
          content: "Exact cleanup fixture content is intentionally long enough.",
          cover: "cover-1",
          category: "Cosplay",
          tags: ["cleanup"],
          visibility: "purchase",
          contentType: "photo_short",
          saleMode: "single_plus_subscription",
          price: 100,
          comments: []
        }
      });
      await tx.mediaAsset.create({
        data: {
          id: assetId,
          postId,
          uploaderUserId: creatorId,
          src: `/api/media/${assetId}/content`,
          alt: "Cleanup media",
          width: 720,
          height: 900,
          order: 0,
          kind: "image",
          mimeType: "image/png",
          sizeBytes: 7,
          storageKey: objectKey,
          derivativeKey: null,
          status: "ready",
          visibility: "purchase"
        }
      });
      await tx.order.create({
        data: {
          id: orderId,
          buyerUserId: buyerId,
          creatorUserId: creatorId,
          kind: "post_unlock",
          itemId: postId,
          amount: 100,
          status: "fulfilled",
          provider: "card",
          platformFeeBps: 2000,
          platformFeeAmount: 20,
          creatorNetAmount: 80
        }
      });
      await tx.paymentIntent.create({
        data: { id: `cleanup-intent-${nonce}`, orderId, provider: "card", status: "succeeded", amount: 100 }
      });
      await tx.paymentTransaction.create({
        data: {
          id: `cleanup-payment-${nonce}`,
          orderId,
          provider: "card",
          amount: 100,
          status: "succeeded",
          platformFeeBps: 2000,
          platformFeeAmount: 20,
          creatorNetAmount: 80
        }
      });
      await tx.entitlement.create({
        data: { id: `cleanup-entitlement-${nonce}`, userId: buyerId, postId, orderId, source: "purchase" }
      });
      await tx.transaction.create({
        data: { id: `cleanup-transaction-${nonce}`, userId: creatorId, orderId, title: "Cleanup income", amount: 80, type: "income", dateLabel: "now", status: "pending" }
      });
      await tx.walletBalance.create({ data: { userId: creatorId, pending: 80 } });
      await tx.notification.create({
        data: { id: `cleanup-notification-${nonce}`, recipientUserId: creatorId, actorUserId: buyerId, type: "purchase", eventKey: `cleanup:${orderId}`, postId, orderId }
      });
      await tx.ledgerAccount.createMany({
        data: [
          { id: accountIds[0], key: `cleanup:provider:${nonce}`, type: "provider_clearing", balance: -100 },
          { id: accountIds[1], key: `cleanup:platform:${nonce}`, type: "platform_revenue", balance: 20 },
          { id: accountIds[2], key: `creator:${creatorId}:pending:CNY`, ownerUserId: creatorId, type: "creator_pending", balance: 80 }
        ]
      });
      await tx.ledgerTransaction.create({
        data: {
          id: `cleanup-ledger-${nonce}`,
          idempotencyKey: `payment:${orderId}`,
          type: "payment_capture",
          referenceType: "order",
          referenceId: orderId,
          entries: {
            create: [
              { accountId: accountIds[0], amount: -100 },
              { accountId: accountIds[1], amount: 20 },
              { accountId: accountIds[2], amount: 80 }
            ]
          }
        }
      });
    });
    await putPhase7LifecycleTestObject(objectKey, Buffer.from("cleanup"), "image/png");
    await putPhase7LifecycleTestObject(orphanAttemptKey, Buffer.from("orphan"), "image/jpeg");
    delayedDerivativeWrite = new Promise<void>((resolveWrite, rejectWrite) => {
      setTimeout(() => {
        void putPhase7LifecycleTestObject(derivativeKey, Buffer.from("delayed"), "image/jpeg")
          .then(() => resolveWrite())
          .catch(rejectWrite);
      }, 150);
    });

    await cleanupPhase7MediaLifecycle(scope);
    await delayedDerivativeWrite;
    expect(scope.objectKeys.has(derivativeKey)).toBe(true);
    expect(scope.objectKeys.has(orphanAttemptKey)).toBe(true);
    expect(await prisma.ledgerAccount.count({ where: { id: accountIds[2] } })).toBe(0);
    expect(await prisma.ledgerAccount.findMany({
      where: { id: { in: accountIds.slice(0, 2) } },
      select: { balance: true },
      orderBy: { id: "asc" }
    })).toEqual([{ balance: 0 }, { balance: 0 }]);
    await cleanupPhase7MediaLifecycle(scope);
    await assertPhase7MediaLifecycleAbsent(scope);
  } finally {
    await delayedDerivativeWrite?.catch(() => undefined);
    let finalCleanupError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await cleanupPhase7MediaLifecycle(scope);
        finalCleanupError = undefined;
      } catch (error) {
        finalCleanupError = error;
      }
    }
    await prisma.ledgerAccount.deleteMany({
      where: {
        id: { in: accountIds.slice(0, 2) },
        ownerUserId: null,
        entries: { none: {} }
      }
    }).catch((error) => {
      finalCleanupError ??= error;
    });
    if (finalCleanupError) throw finalCleanupError;
  }
});

test("lifecycle cleanup rejects an unsnapshotted shared-user ledger account without deleting it", async ({ request }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared-account provenance integration runs once.");
  test.skip(!(await hasDatabase(request)), "Ledger provenance integration requires PostgreSQL.");
  test.skip(!(await prisma.user.findUnique({ where: { id: "c1" }, select: { id: true } })), "Seeded shared creator c1 is required.");

  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const creatorId = `provenance-creator-${nonce}`;
  const buyerId = `provenance-buyer-${nonce}`;
  const creatorEmail = `${creatorId}@e2e.purehub.local`;
  const buyerEmail = `${buyerId}@e2e.purehub.local`;
  const orderId = `provenance-order-${nonce}`;
  const accountId = `provenance-shared-account-${nonce}`;
  const ledgerId = `provenance-ledger-${nonce}`;
  const scope = createPhase7MediaLifecycleCleanupScope();
  scope.identityEmails.add(creatorEmail);
  scope.identityEmails.add(buyerEmail);
  scope.identities.push(
    { id: creatorId, email: creatorEmail },
    { id: buyerId, email: buyerEmail }
  );
  scope.orderIds.add(orderId);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          { id: creatorId, name: "Provenance Creator", handle: `pc-${nonce}`.slice(0, 30), avatar: "avatar-1", email: creatorEmail },
          { id: buyerId, name: "Provenance Buyer", handle: `pb-${nonce}`.slice(0, 30), avatar: "avatar-1", email: buyerEmail }
        ]
      });
      await tx.order.create({
        data: {
          id: orderId,
          buyerUserId: buyerId,
          creatorUserId: creatorId,
          kind: "post_unlock",
          itemId: `missing-post-${nonce}`,
          amount: 10,
          status: "fulfilled",
          provider: "card",
          platformFeeAmount: 0,
          creatorNetAmount: 10
        }
      });
      await tx.ledgerAccount.create({
        data: {
          id: accountId,
          key: `provenance:shared:${nonce}`,
          ownerUserId: "c1",
          type: "creator_pending",
          balance: 10
        }
      });
      await tx.ledgerTransaction.create({
        data: {
          id: ledgerId,
          idempotencyKey: `payment:${orderId}`,
          type: "payment_capture",
          referenceType: "order",
          referenceId: orderId,
          entries: { create: { accountId, amount: 10 } }
        }
      });
    });

    await expect(cleanupPhase7MediaLifecycle(scope)).rejects.toThrow(
      "Cleanup refuses an unexpected shared or unowned ledger account absent from the snapshot."
    );
    expect(await prisma.ledgerAccount.findUnique({
      where: { id: accountId },
      select: { ownerUserId: true, balance: true }
    })).toEqual({ ownerUserId: "c1", balance: 10 });
    expect(await prisma.order.count({ where: { id: orderId } })).toBe(1);
  } finally {
    await prisma.ledgerTransaction.deleteMany({ where: { id: ledgerId } }).catch(() => undefined);
    await prisma.ledgerAccount.deleteMany({ where: { id: accountId, ownerUserId: "c1" } }).catch(() => undefined);
    await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: { id: { in: [creatorId, buyerId] }, email: { in: [creatorEmail, buyerEmail] } }
    }).catch(() => undefined);
  }
});
