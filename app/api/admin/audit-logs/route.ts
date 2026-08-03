import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-auth";
import { listAuditLogs } from "../../../../lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PAGE_SIZE = 20;
type AuditCursor = { createdAt: string; id: string };

export function encodeAuditCursor(marker: AuditCursor) {
  return Buffer.from(JSON.stringify({ version: 1, ...marker }), "utf8").toString("base64url");
}

export function parseAuditCursor(value: string | null) {
  if (value === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid encoding");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (Object.keys(parsed).sort().join(",") !== "createdAt,id,version" || parsed.version !== 1 || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.id || new Date(parsed.createdAt).toISOString() !== parsed.createdAt) {
      throw new Error("invalid payload");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
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
  try {
    const cursor = parseAuditCursor(params.get("cursor"));
    const allLogs = [...await listAuditLogs()].sort((left, right) => {
      const timeDifference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      return timeDifference || left.id.localeCompare(right.id);
    });
    const cursorIndex = cursor ? allLogs.findIndex((log) => log.id === cursor.id && new Date(log.createdAt).toISOString() === cursor.createdAt) : -1;
    if (cursor && cursorIndex < 0) throw new Error("Audit cursor is invalid.");
    const offset = cursorIndex + 1;
    const logs = allLogs.slice(offset, offset + PAGE_SIZE);
    const last = logs.at(-1);
    const nextCursor = last && allLogs.length > offset + PAGE_SIZE
      ? encodeAuditCursor({ createdAt: new Date(last.createdAt).toISOString(), id: last.id })
      : null;
    return NextResponse.json({ logs, nextCursor });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Audit cursor is invalid." }, { status: 400 });
  }
}
