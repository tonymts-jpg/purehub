import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAuditLogs } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "audit");
  if (!auth.ok) return auth.response;

  const logs = await listAuditLogs();
  return NextResponse.json({ logs });
}
