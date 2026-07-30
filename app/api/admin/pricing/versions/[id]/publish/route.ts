import { NextResponse } from "next/server";
import { canAdminManageSettings, requireAdmin } from "@/lib/admin-auth";
import { publishPricingVersion } from "@/lib/admin-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "settings", "write");
  if (!auth.ok) return auth.response;
  if (!canAdminManageSettings(auth.admin.role, "operations")) {
    return NextResponse.json({ error: "Admin role cannot manage operational settings." }, { status: 403 });
  }

  const { id } = await params;
  const version = await publishPricingVersion(auth.admin, id);
  return NextResponse.json({ version });
}
