import { randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";

const configured = () => Boolean(process.env.OBJECT_STORAGE_ENDPOINT && process.env.OBJECT_STORAGE_ACCESS_KEY && process.env.OBJECT_STORAGE_SECRET_KEY);
const bucket = () => process.env.OBJECT_STORAGE_BUCKET ?? "purehub-media";

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
  const uploadUrl = await getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket(), Key: storageKey, ContentType: input.mimeType }), { expiresIn: 900 });
  return { asset, uploadUrl, headers: { "content-type": input.mimeType } };
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
      src: configured() && !simulated ? asset.src : `/api/media/${asset.id}/access`
    }
  });
}

async function bodyToBuffer(body: AsyncIterable<Uint8Array> | undefined) {
  if (!body) throw new Error("Storage object body is empty.");
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function processPendingMedia() {
  if (!configured()) return { processed: 0, skipped: true };
  const assets = await prisma.mediaAsset.findMany({ where: { status: "processing" }, take: 20, orderBy: { createdAt: "asc" } });
  let processed = 0;
  for (const asset of assets) {
    try {
      if (!asset.storageKey) throw new Error("Storage key is missing.");
      let derivativeKey = asset.storageKey;
      if (asset.kind === "image") {
        const object = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: asset.storageKey }));
        const input = await bodyToBuffer(object.Body as AsyncIterable<Uint8Array> | undefined);
        const watermark = Buffer.from(`<svg width="600" height="100"><text x="20" y="65" font-size="42" fill="white" fill-opacity="0.55">PureHub</text></svg>`);
        const output = await sharp(input).rotate().composite([{ input: watermark, gravity: "southeast" }]).jpeg({ quality: 88 }).toBuffer();
        derivativeKey = `derivatives/${asset.id}/watermarked.jpg`;
        await client().send(new PutObjectCommand({ Bucket: bucket(), Key: derivativeKey, Body: output, ContentType: "image/jpeg" }));
      }
      await prisma.mediaAsset.update({ where: { id: asset.id }, data: { derivativeKey, status: "ready", processingError: null, src: `/api/media/${asset.id}/access` } });
      processed += 1;
    } catch (error) {
      await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "failed", processingError: error instanceof Error ? error.message : "Media processing failed." } });
    }
  }
  return { processed, skipped: false };
}

export async function mediaAccess(assetId: string, userId?: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { post: true } });
  if (!asset || asset.status !== "ready") throw new Error("Media is not ready.");
  if (!asset.storageKey) return { assetId: asset.id, url: asset.src, expiresIn: null };

  const isPublic = asset.visibility === "public" || asset.post?.visibility === "free";
  let authorized = isPublic;
  if (!authorized && userId && asset.post) {
    const [entitlement, subscription] = await Promise.all([
      prisma.entitlement.findFirst({ where: { userId, postId: asset.post.id } }),
      prisma.subscription.findFirst({ where: { userId, creatorId: asset.post.creatorId, status: "active" } })
    ]);
    authorized = Boolean(entitlement || subscription || userId === asset.post.creatorId);
  }
  if (!authorized) throw new Error("Media access is not authorized.");
  const key = asset.derivativeKey ?? asset.storageKey;
  if (!configured()) return { assetId: asset.id, url: `mock://download/${key}`, expiresIn: 300 };
  return { assetId: asset.id, url: await getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: 300 }), expiresIn: 300 };
}
