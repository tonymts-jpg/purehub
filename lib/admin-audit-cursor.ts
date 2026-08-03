import type { AdminAuditCursor } from "./admin-repository";

export function encodeAuditCursor(marker: AdminAuditCursor | { createdAt: string; id: string }) {
  const createdAt = marker.createdAt instanceof Date ? marker.createdAt.toISOString() : marker.createdAt;
  return Buffer.from(JSON.stringify({ version: 1, createdAt, id: marker.id }), "utf8").toString("base64url");
}

export function parseAuditCursor(value: string | null) {
  if (value === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid encoding");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (Object.keys(parsed).sort().join(",") !== "createdAt,id,version" || parsed.version !== 1 || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.id || new Date(parsed.createdAt).toISOString() !== parsed.createdAt) {
      throw new Error("invalid payload");
    }
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new Error("Audit cursor is invalid.");
  }
}
