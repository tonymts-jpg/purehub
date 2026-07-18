import { NextResponse } from "next/server";
import { requireAdmin, adminPermissions } from "@/lib/admin-auth";
import { getAdminOverview } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "overview");
  if (!auth.ok) return auth.response;

  const overview = await getAdminOverview();
  return NextResponse.json({ ...overview, admin: { role: auth.admin.role, permissions: adminPermissions(auth.admin.role) } });
}
