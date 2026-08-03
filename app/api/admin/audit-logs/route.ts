import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-auth";
import { listAuditLogs, type AdminAuditCursor } from "../../../../lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "audit", "read");
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "cursor") || params.getAll("cursor").length > 1) {
    return NextResponse.json({ error: "Audit query is invalid." }, { status: 400 });
  }
  let cursor: AdminAuditCursor | null;
  try {
    cursor = parseAuditCursor(params.get("cursor"));
  } catch {
    return NextResponse.json({ error: "Audit cursor is invalid." }, { status: 400 });
  }
  try {
    const page = await listAuditLogs({ cursor });
    return NextResponse.json({
      logs: page.logs,
      nextCursor: page.nextCursor ? encodeAuditCursor(page.nextCursor) : null
    });
  } catch {
    return NextResponse.json({ error: "Unable to load audit logs." }, { status: 500 });
  }
}
