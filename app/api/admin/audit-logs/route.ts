import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-auth";
import { encodeAuditCursor, parseAuditCursor } from "../../../../lib/admin-audit-cursor";
import { listAuditLogs, type AdminAuditCursor } from "../../../../lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
