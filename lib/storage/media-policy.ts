import { z } from "zod";

export type UploadMediaKind = "image" | "video";

export const UPLOAD_MAX_SIZE_BYTES = 500_000_000;
export const uploadSizeBytesSchema = z.number().int().positive().max(UPLOAD_MAX_SIZE_BYTES);

export const SAFE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif"
] as const;
export const SAFE_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm"
] as const;
const IMAGE_MIME_TYPES = new Set<string>(SAFE_IMAGE_MIME_TYPES);
const VIDEO_MIME_TYPES = new Set<string>(SAFE_VIDEO_MIME_TYPES);
const STATIC_MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".mp4",
  ".webm"
]);

export function acceptsUploadMediaType(input: { kind: UploadMediaKind; mimeType: string }) {
  return input.kind === "image"
    ? IMAGE_MIME_TYPES.has(input.mimeType)
    : VIDEO_MIME_TYPES.has(input.mimeType);
}

export function safeMediaContentType(input: {
  kind: UploadMediaKind;
  mimeType: string;
  derivativeKey?: string | null;
}) {
  if (!acceptsUploadMediaType(input)) {
    throw new Error("Media content type is not allowed.");
  }
  return input.kind === "image" && input.derivativeKey ? "image/jpeg" : input.mimeType;
}

export class MediaRangeError extends Error {
  constructor(public readonly size: number) {
    super("Requested media range is not satisfiable.");
    this.name = "MediaRangeError";
  }
}

export function normalizeByteRange(range: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || !Number.isSafeInteger(size) || size <= 0) throw new MediaRangeError(Math.max(0, size));
  const [, startText, endText] = match;
  if (!startText && !endText) throw new MediaRangeError(size);

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new MediaRangeError(size);
    return range;
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : null;
  if (
    !Number.isSafeInteger(start)
    || start < 0
    || start >= size
    || (end !== null && (!Number.isSafeInteger(end) || end < start))
  ) {
    throw new MediaRangeError(size);
  }
  return range;
}

export function resolveStaticMediaRedirect(src: string, requestUrl: string) {
  if (
    !src.startsWith("/generated/")
    || src.includes("\\")
    || src.includes("%")
    || src.includes("?")
    || src.includes("#")
  ) {
    throw new Error("Static media redirect is not allowed.");
  }

  const requestOrigin = new URL(requestUrl).origin;
  const target = new URL(src, requestUrl);
  const extensionIndex = target.pathname.lastIndexOf(".");
  const extension = extensionIndex === -1 ? "" : target.pathname.slice(extensionIndex).toLowerCase();
  if (
    target.origin !== requestOrigin
    || target.pathname !== src
    || target.username
    || target.password
    || target.search
    || target.hash
    || !STATIC_MEDIA_EXTENSIONS.has(extension)
  ) {
    throw new Error("Static media redirect is not allowed.");
  }
  return target;
}
