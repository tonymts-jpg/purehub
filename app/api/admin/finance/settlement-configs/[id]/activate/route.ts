import { NextResponse } from "next/server";
import { canAdminManageSettings, requireAdmin } from "@/lib/admin-auth";
import { activateSettlementConfig } from "@/lib/finance/ledger";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, "settings", "write");
  if (!auth.ok) return auth.response;
  if (!canAdminManageSettings(auth.admin.role, "finance")) {
    return NextResponse.json({ error: "Admin role cannot manage finance settings." }, { status: 403 });
  }
  try {
    const { id } = await params;
    return NextResponse.json({ config: await activateSettlementConfig(auth.admin, id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to activate settlement config." }, { status: 400 });
  }
}
