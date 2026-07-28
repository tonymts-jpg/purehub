import { expect, test } from "@playwright/test";
import { claimPendingMediaAsset, processPendingMedia } from "../lib/storage/media";
import { prisma } from "../lib/prisma";

type FakeAsset = {
  id: string;
  storageKey: string;
  derivativeKey: string | null;
  status: string;
  kind: string;
  processingError?: string | null;
  src?: string;
  createdAt: Date;
  updatedAt: Date;
};

function createMediaDatabase(asset: FakeAsset, clock: () => Date = () => new Date()) {
  const records = new Map([[asset.id, asset]]);
  const matches = (
    record: FakeAsset,
    where: {
      id?: string;
      status?: string | { startsWith: string };
      updatedAt?: { lt: Date };
    }
  ) => (
    (where.id === undefined || record.id === where.id)
    && (
      where.status === undefined
      || (typeof where.status === "string"
        ? record.status === where.status
        : record.status.startsWith(where.status.startsWith))
    )
    && (where.updatedAt === undefined || record.updatedAt < where.updatedAt.lt)
  );
  return {
    records,
    mediaAsset: {
      async findMany(input: { where: { status: string | { startsWith: string }; updatedAt?: { lt: Date } }; take: number }) {
        return [...records.values()]
          .filter((record) => matches(record, input.where))
          .slice(0, input.take);
      },
      async updateMany(input: {
        where: { id?: string; status?: string | { startsWith: string }; updatedAt?: { lt: Date } };
        data: Partial<FakeAsset>;
      }) {
        let count = 0;
        for (const record of records.values()) {
          if (!matches(record, input.where)) continue;
          Object.assign(record, input.data, { updatedAt: clock() });
          count += 1;
        }
        return { count };
      },
      async count(input: { where: { id?: string; status?: string | { startsWith: string } } }) {
        return [...records.values()].filter((record) => matches(record, input.where)).length;
      }
    }
  };
}

test("overlapping media processors exclusively claim an asset so the loser never deletes the winner derivative", async () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  const asset: FakeAsset = {
    id: "claim-race-asset",
    storageKey: "original/claim-race/source.png",
    derivativeKey: null,
    status: "processing",
    kind: "image",
    createdAt: new Date("2026-07-28T11:59:00.000Z"),
    updatedAt: new Date("2026-07-28T11:59:00.000Z")
  };
  const database = createMediaDatabase(asset);
  const objects = new Map<string, Buffer>();
  let puts = 0;
  let deletes = 0;
  const options = {
    database,
    storageConfigured: true,
    now: () => now,
    getObject: async () => Buffer.from("source"),
    transformImage: async () => Buffer.from("derivative"),
    putObject: async ({ key, body }: { key: string; body: Buffer }) => {
      puts += 1;
      objects.set(key, body);
    },
    deleteObject: async (key: string) => {
      deletes += 1;
      objects.delete(key);
    }
  };

  const attempts = await Promise.all([
    processPendingMedia(options),
    processPendingMedia(options)
  ]);

  const derivativeKey = database.records.get(asset.id)?.derivativeKey;
  expect(attempts.map(({ processed }) => processed).sort()).toEqual([0, 1]);
  expect(puts).toBe(1);
  expect(deletes).toBe(0);
  expect(derivativeKey).toMatch(new RegExp(`^derivatives/${asset.id}/attempts/[0-9a-f-]{36}\\.jpg$`));
  expect(objects.get(derivativeKey!)?.toString()).toBe("derivative");
  expect(database.records.get(asset.id)?.status).toBe("ready");
});

test("stale takeover keeps the new owner's object when the old owner resumes after both attempts write", async () => {
  let clock = new Date("2026-07-28T12:00:00.000Z");
  const asset: FakeAsset = {
    id: "stale-takeover-asset",
    storageKey: "original/stale-takeover/source.png",
    derivativeKey: null,
    status: "processing",
    kind: "image",
    createdAt: new Date("2026-07-28T11:59:00.000Z"),
    updatedAt: new Date("2026-07-28T11:59:00.000Z")
  };
  const database = createMediaDatabase(asset, () => clock);
  const objects = new Map<string, Buffer>();
  const claimTokensAtWrite: string[] = [];
  const writtenKeys: string[] = [];
  const deletedKeys: string[] = [];
  let wrongTokenCommitCount = -1;
  let releaseOldPut!: () => void;
  const oldPutBlocked = new Promise<void>((resolve) => {
    releaseOldPut = resolve;
  });
  let signalOldPut!: () => void;
  const oldPutStarted = new Promise<void>((resolve) => {
    signalOldPut = resolve;
  });

  const options = {
    database,
    storageConfigured: true,
    now: () => clock,
    getObject: async () => Buffer.from("source"),
    transformImage: async () => Buffer.from("derivative"),
    putObject: async ({ key, body }: { key: string; body: Buffer }) => {
      claimTokensAtWrite.push(database.records.get(asset.id)?.status ?? "missing");
      writtenKeys.push(key);
      objects.set(key, Buffer.from(`${body.toString()}-${writtenKeys.length}`));
      if (writtenKeys.length === 1) {
        signalOldPut();
        await oldPutBlocked;
      } else {
        wrongTokenCommitCount = (await database.mediaAsset.updateMany({
          where: { id: asset.id, status: claimTokensAtWrite[0] },
          data: { status: "ready", derivativeKey: writtenKeys[0] }
        })).count;
      }
    },
    deleteObject: async (key: string) => {
      deletedKeys.push(key);
      objects.delete(key);
    }
  };

  const oldOwner = processPendingMedia(options);
  await oldPutStarted;
  clock = new Date(clock.getTime() + 15 * 60 * 1000 + 1);
  const newOwner = processPendingMedia(options);
  await newOwner;
  releaseOldPut();
  await oldOwner;

  const committed = database.records.get(asset.id);
  expect(writtenKeys).toHaveLength(2);
  expect(new Set(claimTokensAtWrite).size).toBe(2);
  expect(claimTokensAtWrite.every((token) => token.startsWith("processing_claimed:"))).toBe(true);
  expect(wrongTokenCommitCount).toBe(0);
  expect(new Set(writtenKeys).size).toBe(2);
  expect(committed?.status).toBe("ready");
  expect(committed?.derivativeKey).toBe(writtenKeys[1]);
  expect(objects.get(writtenKeys[1])?.toString()).toBe("derivative-2");
  expect(objects.has(writtenKeys[0])).toBe(false);
  expect(deletedKeys.length).toBeGreaterThan(0);
  expect(deletedKeys.every((key) => key === writtenKeys[0])).toBe(true);
});

test("media processing recovers only stale claims after the bounded lease", async () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  const activeClaimStatus = "processing_claimed:22222222-2222-4222-8222-222222222222";
  const staleAsset: FakeAsset = {
    id: "stale-claim-asset",
    storageKey: "original/stale-claim/source.mp4",
    derivativeKey: null,
    status: "processing_claimed:11111111-1111-4111-8111-111111111111",
    kind: "video",
    createdAt: new Date("2026-07-28T11:00:00.000Z"),
    updatedAt: new Date(now.getTime() - 15 * 60 * 1000 - 1)
  };
  const activeAsset: FakeAsset = {
    id: "active-claim-asset",
    storageKey: "original/active-claim/source.mp4",
    derivativeKey: null,
    status: activeClaimStatus,
    kind: "video",
    createdAt: new Date("2026-07-28T11:01:00.000Z"),
    updatedAt: new Date(now.getTime() - 15 * 60 * 1000)
  };
  const staleDatabase = createMediaDatabase(staleAsset);
  const activeDatabase = createMediaDatabase(activeAsset);

  await processPendingMedia({
    database: staleDatabase,
    storageConfigured: true,
    now: () => now
  });
  await processPendingMedia({
    database: activeDatabase,
    storageConfigured: true,
    now: () => now
  });

  expect(staleDatabase.records.get(staleAsset.id)?.status).toBe("ready");
  expect(activeDatabase.records.get(activeAsset.id)?.status).toBe(activeClaimStatus);
});

test("cleanup can take a claimed asset during derivative PUT and the writer removes only its uncommitted object", async () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  const asset: FakeAsset = {
    id: "claim-cleanup-asset",
    storageKey: "original/claim-cleanup/source.png",
    derivativeKey: null,
    status: "processing",
    kind: "image",
    createdAt: new Date("2026-07-28T11:59:00.000Z"),
    updatedAt: new Date("2026-07-28T11:59:00.000Z")
  };
  const database = createMediaDatabase(asset);
  const winnerKey = "derivatives/another-asset/watermarked.jpg";
  const objects = new Map<string, Buffer>([[winnerKey, Buffer.from("winner")]]);
  const deletedKeys: string[] = [];

  const result = await processPendingMedia({
    database,
    storageConfigured: true,
    now: () => now,
    getObject: async () => Buffer.from("source"),
    transformImage: async () => Buffer.from("derivative"),
    putObject: async ({ key, body }) => {
      objects.set(key, body);
      const record = database.records.get(asset.id);
      if (record) {
        record.status = "cleanup_pending";
        record.updatedAt = new Date();
      }
    },
    deleteObject: async (key) => {
      deletedKeys.push(key);
      objects.delete(key);
    }
  });

  const derivativeKey = deletedKeys[0];
  expect(result.processed).toBe(0);
  expect(deletedKeys).toEqual([derivativeKey]);
  expect(derivativeKey).toMatch(new RegExp(`^derivatives/${asset.id}/attempts/[0-9a-f-]{36}\\.jpg$`));
  expect(objects.has(derivativeKey)).toBe(false);
  expect(objects.get(winnerKey)?.toString()).toBe("winner");
  expect(database.records.get(asset.id)?.status).toBe("cleanup_pending");
});

test("a claimed processor records transform failure only while it still owns the claim", async () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  const asset: FakeAsset = {
    id: "claim-failure-asset",
    storageKey: "original/claim-failure/source.png",
    derivativeKey: null,
    status: "processing",
    kind: "image",
    createdAt: new Date("2026-07-28T11:59:00.000Z"),
    updatedAt: new Date("2026-07-28T11:59:00.000Z")
  };
  const database = createMediaDatabase(asset);

  const result = await processPendingMedia({
    database,
    storageConfigured: true,
    now: () => now,
    getObject: async () => Buffer.from("invalid-source"),
    transformImage: async () => {
      throw new Error("Invalid image payload.");
    }
  });

  expect(result.processed).toBe(0);
  expect(database.records.get(asset.id)).toMatchObject({
    status: "failed",
    processingError: "Invalid image payload."
  });
});

test("PostgreSQL grants exactly one exclusive claim for concurrent attempts", async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The shared database mutation runs once.");
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    test.skip(true, "Atomic media claim integration requires PostgreSQL.");
  }

  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const assetId = `media-claim-${nonce}`;
  try {
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        alt: "Atomic media claim fixture",
        width: 1,
        height: 1,
        order: 0,
        kind: "video",
        mimeType: "video/mp4",
        sizeBytes: 1,
        storageKey: `original/media-claim/${nonce}.mp4`,
        status: "processing",
        visibility: "public"
      }
    });

    const claims = await Promise.all([
      claimPendingMediaAsset(assetId),
      claimPendingMediaAsset(assetId)
    ]);

    const claimed = claims.filter((claim): claim is string => Boolean(claim));
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatch(/^processing_claimed:[0-9a-f-]{36}$/);
    const wrongTokenCommit = await prisma.mediaAsset.updateMany({
      where: {
        id: assetId,
        status: "processing_claimed:55555555-5555-4555-8555-555555555555"
      },
      data: { status: "ready", derivativeKey: `derivatives/${assetId}/attempts/wrong.jpg` }
    });
    expect(wrongTokenCommit.count).toBe(0);
    expect(await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { status: true }
    })).toEqual({ status: claimed[0] });
  } finally {
    await prisma.mediaAsset.deleteMany({ where: { id: assetId } }).catch(() => undefined);
  }
});
