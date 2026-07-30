import { NextResponse } from "next/server";
import { z } from "zod";
import { canAdminManageSettings, requireAdmin } from "@/lib/admin-auth";
import { createSettlementConfig, listSettlementConfigs } from "@/lib/finance/ledger";

export const dynamic = "force-dynamic";
const schema = z.object({ name: z.string().min(3), holdDays: z.number().int().min(0).max(90) });

export async function GET(request: Request) {
  const auth = await requireAdmin(request, "settings", "read");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ configs: await listSettlementConfigs() });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "settings", "write");
  if (!auth.ok) return auth.response;
  if (!canAdminManageSettings(auth.admin.role, "finance")) {
    return NextResponse.json({ error: "Admin role cannot manage finance settings." }, { status: 403 });
  }
  try {
    return NextResponse.json({ config: await createSettlementConfig(auth.admin, schema.parse(await request.json())) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create settlement config." }, { status: 400 });
  }
}
