import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { writeDerivativeWithConditionalCommit } from "@/lib/storage/media-finalization";
import { acceptsUploadMediaType, normalizeByteRange, safeMediaContentType } from "@/lib/storage/media-policy";

const configured = () => Boolean(process.env.OBJECT_STORAGE_ENDPOINT && process.env.OBJECT_STORAGE_ACCESS_KEY && process.env.OBJECT_STORAGE_SECRET_KEY);
const bucket = () => process.env.OBJECT_STORAGE_BUCKET ?? "purehub-media";
const MEDIA_CLAIM_STALE_AFTER_MS = 15 * 60 * 1000;
const MEDIA_CLAIM_PREFIX = "processing_claimed:";
const MEDIA_RECOVERY_PREFIX = "processing_recovering:";

type MediaProcessingAsset = {
  id: string;
  storageKey: string | null;
  kind: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type MediaProcessingStatusFilter = string | { startsWith: string };

type MediaProcessingDatabase = {
  mediaAsset: {
    findMany(input: {
      where: { status: MediaProcessingStatusFilter; updatedAt?: { lt: Date } };
      take: number;
      orderBy: { createdAt: "asc" };
    }): Promise<MediaProcessingAsset[]>;
    updateMany(input: {
      where: { id?: string; status?: MediaProcessingStatusFilter; updatedAt?: { lt: Date } };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    count(input: { where: { id?: string; status?: MediaProcessingStatusFilter } }): Promise<number>;
  };
};

type MediaProcessingOptions = {
  database?: MediaProcessingDatabase;
  storageConfigured?: boolean;
  now?: () => Date;
  getObject?: (key: string) => Promise<Buffer>;
  putObject?: (input: { key: string; body: Buffer; contentType: string }) => Promise<void>;
  deleteObject?: (key: string) => Promise<void>;
  transformImage?: (input: Buffer) => Promise<Buffer>;
};

function client() {
  return new S3Client({
    region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1",
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "minioadmin",
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "minioadmin"
    }
  });
}

export async function createUpload(input: {
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video";
  visibility: "public" | "members" | "purchase";
}) {
  if (!acceptsUploadMediaType(input)) throw new Error("Unsupported media type.");
  const extension = input.fileName.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
  const storageKey = `original/${input.userId}/${randomUUID()}.${extension}`;
  const asset = await prisma.mediaAsset.create({
    data: {
      uploaderUserId: input.userId,
      alt: input.fileName,
      width: 0,
      height: 0,
      order: 0,
      kind: input.kind,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey,
      status: "uploading",
      visibility: input.visibility
    }
  });
  if (!configured()) return { asset, uploadUrl: `mock://upload/${asset.id}`, headers: { "content-type": input.mimeType } };
  return { asset, uploadUrl: `/api/uploads/${asset.id}/content`, headers: { "content-type": input.mimeType } };
}

export async function storeUploadContent(input: {
  assetId: string;
  userId: string;
  mimeType: string;
  sizeBytes: number;
  body: Readable;
}) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: input.assetId } });
  if (!asset || asset.uploaderUserId !== input.userId || asset.status !== "uploading" || !asset.storageKey) {
    throw new Error("Upload asset not found.");
  }
  if (
    !acceptsUploadMediaType({
      kind: asset.kind === "video" ? "video" : "image",
      mimeType: asset.mimeType
    })
    || input.mimeType !== asset.mimeType
    || input.sizeBytes !== asset.sizeBytes
  ) {
    throw new Error("Upload content metadata does not match the prepared asset.");
  }
  if (!configured()) throw new Error("Object storage is unavailable.");

  await client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: asset.storageKey,
    Body: input.body,
    ContentType: asset.mimeType,
    ContentLength: asset.sizeBytes
  }));
}

export async function createKycDocumentUpload(input: { userId: string; fileName: string; mimeType: string }) {
  const extension = input.fileName.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
  const documentKey = `kyc/${input.userId}/${randomUUID()}.${extension}`;
  if (!configured()) return { documentKey, uploadUrl: `mock://kyc-upload/${documentKey}`, headers: { "content-type": input.mimeType } };
  return {
    documentKey,
    uploadUrl: await getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket(), Key: documentKey, ContentType: input.mimeType }), { expiresIn: 900 }),
    headers: { "content-type": input.mimeType }
  };
}

export async function completeUpload(input: { assetId: string; userId: string; checksum?: string; width?: number; height?: number; durationSeconds?: number; simulate?: boolean }) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: input.assetId } });
  if (!asset || asset.uploaderUserId !== input.userId) throw new Error("Upload asset not found.");
  if (asset.status !== "uploading" && asset.status !== "processing") return asset;
  const simulated = input.simulate && process.env.APP_ENV !== "production";
  if (configured() && asset.storageKey && !simulated) await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: asset.storageKey }));
  return prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      checksum: input.checksum,
      width: input.width ?? asset.width,
      height: input.height ?? asset.height,
      durationSeconds: input.durationSeconds,
      status: configured() && !simulated ? "processing" : "ready",
      src: configured() && !simulated ? asset.src : `/api/media/${asset.id}/content`
    }
  });
}

async function bodyToBuffer(body: AsyncIterable<Uint8Array> | undefined) {
  if (!body) throw new Error("Storage object body is empty.");
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function claimIdFromStatus(status: string) {
  const prefix = status.startsWith(MEDIA_CLAIM_PREFIX)
    ? MEDIA_CLAIM_PREFIX
    : status.startsWith(MEDIA_RECOVERY_PREFIX)
      ? MEDIA_RECOVERY_PREFIX
      : null;
  if (!prefix) throw new Error("Media processing claim is invalid.");
  const claimId = status.slice(prefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(claimId)) {
    throw new Error("Media processing claim is invalid.");
  }
  return claimId;
}

export function mediaProcessingAttemptKey(assetId: string, claimStatus: string) {
  return `derivatives/${assetId}/attempts/${claimIdFromStatus(claimStatus)}.jpg`;
}

export async function claimPendingMediaAsset(
  assetId: string,
  database: MediaProcessingDatabase = prisma as unknown as MediaProcessingDatabase,
  claimId = randomUUID()
) {
  const claimStatus = `${MEDIA_CLAIM_PREFIX}${claimId}`;
  const claim = await database.mediaAsset.updateMany({
    where: { id: assetId, status: "processing" },
    data: { status: claimStatus }
  });
  return claim.count === 1 ? claimStatus : null;
}

async function recoverStaleMediaClaims(input: {
  database: MediaProcessingDatabase;
  cutoff: Date;
  deleteObject: (key: string) => Promise<void>;
}) {
  for (const prefix of [MEDIA_RECOVERY_PREFIX, MEDIA_CLAIM_PREFIX]) {
    const staleClaims = await input.database.mediaAsset.findMany({
      where: { status: { startsWith: prefix }, updatedAt: { lt: input.cutoff } },
      take: 20,
      orderBy: { createdAt: "asc" }
    });
    for (const asset of staleClaims) {
      const claimId = claimIdFromStatus(asset.status);
      const recoveryStatus = `${MEDIA_RECOVERY_PREFIX}${claimId}`;
      if (prefix === MEDIA_CLAIM_PREFIX) {
        const recoveryClaim = await input.database.mediaAsset.updateMany({
          where: { id: asset.id, status: asset.status, updatedAt: { lt: input.cutoff } },
          data: { status: recoveryStatus }
        });
        if (recoveryClaim.count !== 1) continue;
      }
      try {
        if (asset.kind === "image") {
          await input.deleteObject(mediaProcessingAttemptKey(asset.id, recoveryStatus));
        }
      } catch {
        continue;
      }
      await input.database.mediaAsset.updateMany({
        where: { id: asset.id, status: recoveryStatus },
        data: { status: "processing" }
      });
    }
  }
}

export async function processPendingMedia(options: MediaProcessingOptions = {}) {
  const database = options.database ?? (prisma as unknown as MediaProcessingDatabase);
  const storageConfigured = options.storageConfigured ?? configured();
  if (!storageConfigured) return { processed: 0, skipped: true };
  const now = options.now ?? (() => new Date());
  const getObject = options.getObject ?? (async (key: string) => {
    const object = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return bodyToBuffer(object.Body as AsyncIterable<Uint8Array> | undefined);
  });
  const putObject = options.putObject ?? (async (input: { key: string; body: Buffer; contentType: string }) => {
    await client().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType
    }));
  });
  const deleteObject = options.deleteObject ?? (async (key: string) => {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  });
  const transformImage = options.transformImage ?? (async (input: Buffer) => {
    const watermark = Buffer.from(`<svg width="600" height="100"><text x="20" y="65" font-size="42" fill="white" fill-opacity="0.55">PureHub</text></svg>`);
    return sharp(input).rotate().composite([{ input: watermark, gravity: "southeast" }]).jpeg({ quality: 88 }).toBuffer();
  });

  await recoverStaleMediaClaims({
    database,
    cutoff: new Date(now().getTime() - MEDIA_CLAIM_STALE_AFTER_MS),
    deleteObject
  });
  const assets = await database.mediaAsset.findMany({
    where: { status: "processing" },
    take: 20,
    orderBy: { createdAt: "asc" }
  });
  let processed = 0;
  for (const asset of assets) {
    const claimStatus = await claimPendingMediaAsset(asset.id, database);
    if (!claimStatus) continue;
    try {
      if (!asset.storageKey) throw new Error("Storage key is missing.");
      let derivativeKey = asset.storageKey;
      if (asset.kind === "image") {
        const input = await getObject(asset.storageKey);
        const output = await transformImage(input);
        const stillClaimed = await database.mediaAsset.count({
          where: { id: asset.id, status: claimStatus }
        });
        if (!stillClaimed) continue;
        derivativeKey = mediaProcessingAttemptKey(asset.id, claimStatus);
        const committed = await writeDerivativeWithConditionalCommit({
          write: async () => {
            await putObject({ key: derivativeKey, body: output, contentType: "image/jpeg" });
          },
          commit: async () => (await database.mediaAsset.updateMany({
            where: { id: asset.id, status: claimStatus },
            data: { derivativeKey, status: "ready", processingError: null, src: `/api/media/${asset.id}/content` }
          })).count === 1,
          remove: async () => {
            await deleteObject(derivativeKey);
          }
        });
        processed += committed ? 1 : 0;
        continue;
      }
      const completed = await database.mediaAsset.updateMany({
        where: { id: asset.id, status: claimStatus },
        data: { derivativeKey, status: "ready", processingError: null, src: `/api/media/${asset.id}/content` }
      });
      processed += completed.count;
    } catch (error) {
      await database.mediaAsset.updateMany({
        where: { id: asset.id, status: claimStatus },
        data: { status: "failed", processingError: error instanceof Error ? error.message : "Media processing failed." }
      });
    }
  }
  return { processed, skipped: false };
}

async function authorizeReadyMedia(assetId: string, userId?: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { post: true } });
  if (!asset || asset.status !== "ready") throw new Error("Media is not ready.");

  const isPublic = (asset.visibility === "public" || asset.visibility === "free") && asset.post?.visibility === "free";
  let authorized = isPublic;
  if (!authorized && userId && asset.post) {
    const [entitlement, subscription] = await Promise.all([
      prisma.entitlement.findFirst({ where: { userId, postId: asset.post.id } }),
      prisma.subscription.findFirst({ where: { userId, creatorId: asset.post.creatorId, status: "active" } })
    ]);
    authorized = Boolean(entitlement || subscription || userId === asset.post.creatorId);
  }
  if (!authorized) throw new Error("Media access is not authorized.");
  return { asset, isPublic };
}

export async function mediaAccess(assetId: string, userId?: string) {
  const { asset } = await authorizeReadyMedia(assetId, userId);
  if (!asset.storageKey) return { assetId: asset.id, url: asset.src, expiresIn: null };
  const key = asset.derivativeKey ?? asset.storageKey;
  if (!configured()) return { assetId: asset.id, url: `mock://download/${key}`, expiresIn: 300 };
  return { assetId: asset.id, url: await getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: 300 }), expiresIn: 300 };
}

function webStream(body: unknown): ReadableStream<Uint8Array> {
  if (body && typeof body === "object" && "transformToWebStream" in body) {
    return (body as { transformToWebStream(): ReadableStream<Uint8Array> }).transformToWebStream();
  }
  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  }
  throw new Error("Storage object body is unavailable.");
}

export async function mediaContent(assetId: string, userId?: string, range?: string | null) {
  const { asset, isPublic } = await authorizeReadyMedia(assetId, userId);
  const contentType = safeMediaContentType({
    kind: asset.kind === "video" ? "video" : "image",
    mimeType: asset.mimeType,
    derivativeKey: asset.derivativeKey
  });
  if (!asset.storageKey) {
    if (!asset.src.startsWith("/") || asset.src.startsWith("//") || asset.src === `/api/media/${asset.id}/content`) {
      throw new Error("Media content is unavailable.");
    }
    return { kind: "redirect" as const, url: asset.src, isPublic };
  }
  if (!configured()) throw new Error("Media content is unavailable.");

  const key = asset.derivativeKey ?? asset.storageKey;
  const objectSize = range
    ? (await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))).ContentLength
    : undefined;
  const objectRange = range ? normalizeByteRange(range, objectSize ?? 0) : undefined;
  const object = await client().send(new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ...(objectRange ? { Range: objectRange } : {})
  }));
  return {
    kind: "stream" as const,
    body: webStream(object.Body),
    status: object.ContentRange ? 206 : 200,
    isPublic,
    headers: {
      "accept-ranges": object.AcceptRanges ?? "bytes",
      "content-type": contentType,
      ...(object.ContentLength === undefined ? {} : { "content-length": String(object.ContentLength) }),
      ...(object.ContentRange ? { "content-range": object.ContentRange } : {}),
      ...(object.ETag ? { etag: object.ETag } : {})
    }
  };
}
